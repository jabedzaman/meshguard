package agent

import (
	"net"
	"net/netip"
	"sync"
	"time"

	"github.com/jabedzaman/meshguard/internal/stun"
)

// stunFreshFor is how long a STUN result is advertised without a new answer.
const stunFreshFor = time.Minute

// natState is what STUN servers told us about our public address.
type natState struct {
	mu       sync.Mutex
	pending  map[stun.TxID]stunRequest
	public   netip.AddrPort
	publicAt time.Time
	byServer map[string]stunAnswer
}

type stunRequest struct {
	server string
	sent   time.Time
}

type stunAnswer struct {
	public  netip.AddrPort
	at      time.Time
	latency time.Duration
}

func (n *natState) handle(packet []byte) {
	tx, addr, err := stun.ParseResponse(packet)
	if err != nil {
		return
	}
	n.mu.Lock()
	defer n.mu.Unlock()
	req, ok := n.pending[tx]
	if !ok {
		return
	}
	delete(n.pending, tx)
	now := time.Now()
	n.public, n.publicAt = addr, now
	if n.byServer == nil {
		n.byServer = map[string]stunAnswer{}
	}
	n.byServer[req.server] = stunAnswer{public: addr, at: now, latency: now.Sub(req.sent)}
}

func (n *natState) publicEndpoint() (netip.AddrPort, bool) {
	n.mu.Lock()
	defer n.mu.Unlock()
	return n.public, n.public.IsValid() && time.Since(n.publicAt) < stunFreshFor
}

func (n *natState) answer(server string, since time.Time) (stunAnswer, bool) {
	n.mu.Lock()
	defer n.mu.Unlock()
	ans, ok := n.byServer[server]
	return ans, ok && !ans.at.Before(since)
}

func (n *natState) newRequest(server string) []byte {
	tx, req := stun.Request()
	n.mu.Lock()
	defer n.mu.Unlock()
	if n.pending == nil {
		n.pending = map[stun.TxID]stunRequest{}
	}
	for old, r := range n.pending {
		if time.Since(r.sent) > 30*time.Second {
			delete(n.pending, old)
		}
	}
	n.pending[tx] = stunRequest{server: server, sent: time.Now()}
	return req
}

func (n *natState) reset() {
	n.mu.Lock()
	defer n.mu.Unlock()
	n.pending, n.byServer = nil, nil
	n.public, n.publicAt = netip.AddrPort{}, time.Time{}
}

// probeStun asks each STUN server for our public address from WireGuard's
// socket. Answers arrive through the interceptor.
func (a *Agent) probeStun(engine Engine, servers []string) (sent []string) {
	for _, server := range servers {
		addr, err := net.ResolveUDPAddr("udp4", server)
		if err != nil {
			continue
		}
		ap := addr.AddrPort()
		if engine.SendTo(netip.AddrPortFrom(ap.Addr().Unmap(), ap.Port()), a.nat.newRequest(server)) == nil {
			sent = append(sent, server)
		}
	}
	return sent
}

// classifyNAT compares the public addresses different STUN servers saw. The
// same address from each means endpoint-independent mapping (hole punching
// can work); different ports mean a symmetric NAT (needs the relay).
func classifyNAT(publics []netip.AddrPort) string {
	if len(publics) < 2 {
		return "unknown"
	}
	for _, p := range publics[1:] {
		if p != publics[0] {
			return "symmetric"
		}
	}
	return "endpoint-independent"
}
