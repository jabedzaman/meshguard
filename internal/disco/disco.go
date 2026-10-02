// Package disco finds direct paths between peers behind NATs. While a peer is
// only reachable through the relay, both agents ping each other's candidate
// endpoints (LAN and STUN-discovered addresses) from WireGuard's socket; the
// outbound packets open NAT mappings ("hole punching"). A pong over a direct
// address proves the path works both ways, and WireGuard is pointed at it.
//
// Packets: "MSHDSC" + sender public key (32) + nonce (24) + NaCl box of
// type (1) + transaction id (12), sealed with the WireGuard keys, so answers
// can't be forged to redirect traffic.
package disco

import (
	"bytes"
	"crypto/rand"
	"net/netip"
	"sync"
	"time"

	"golang.org/x/crypto/nacl/box"
)

var magic = []byte("MSHDSC")

const (
	typePing byte = 1
	typePong byte = 2

	headerLen = 6 + 32 + 24
	// pingEvery is how often unconfirmed candidates are pinged.
	pingEvery = 2 * time.Second
	// keepEvery is how often a confirmed path is re-checked. Once a check
	// goes unanswered for pingEvery, all candidates are pinged again.
	keepEvery = 5 * time.Second
	// FreshFor is how long a pong keeps a path confirmed.
	FreshFor = 20 * time.Second
)

// Key is a WireGuard (Curve25519) public key.
type Key [32]byte

type txID [12]byte

// Is reports whether b is a disco packet (not WireGuard or STUN).
func Is(b []byte) bool { return len(b) > headerLen && bytes.HasPrefix(b, magic) }

// Manager tracks direct paths to peers.
type Manager struct {
	private [32]byte
	public  Key
	send    func(to netip.AddrPort, packet []byte) error
	now     func() time.Time

	mu    sync.Mutex
	peers map[Key]*peer
}

type peer struct {
	candidates []netip.AddrPort
	// observed are addresses valid pings from this peer came from: its real
	// NAT mapping toward us, which STUN can't predict (e.g. after a port
	// clash). Pinging them back opens the path from our side too.
	observed map[netip.AddrPort]time.Time
	pending  map[txID]sentPing
	best     netip.AddrPort
	lastPong time.Time
	lastPing time.Time
}

type sentPing struct {
	to netip.AddrPort
	at time.Time
}

// NewManager pings and answers as the given WireGuard key, sending packets
// with send (WireGuard's socket).
func NewManager(private [32]byte, public Key, send func(netip.AddrPort, []byte) error) *Manager {
	return &Manager{private: private, public: public, send: send, now: time.Now, peers: map[Key]*peer{}}
}

// SetPeers replaces the peer list with each peer's candidate endpoints.
// Confirmed paths survive if the peer stays.
func (m *Manager) SetPeers(candidates map[Key][]netip.AddrPort) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for key := range m.peers {
		if _, ok := candidates[key]; !ok {
			delete(m.peers, key)
		}
	}
	for key, eps := range candidates {
		p, ok := m.peers[key]
		if !ok {
			p = &peer{pending: map[txID]sentPing{}, observed: map[netip.AddrPort]time.Time{}}
			m.peers[key] = p
		}
		p.candidates = eps
	}
}

// Reset forgets every confirmed path and learned address and pings all
// candidates on the next Tick. Call it when this device's network changed:
// old paths and NAT mappings are likely gone.
func (m *Manager) Reset() {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, p := range m.peers {
		p.best, p.lastPong, p.lastPing = netip.AddrPort{}, time.Time{}, time.Time{}
		p.pending = map[txID]sentPing{}
		p.observed = map[netip.AddrPort]time.Time{}
	}
}

// Direct returns the confirmed direct path to a peer, if any.
func (m *Manager) Direct(key Key) (netip.AddrPort, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	p, ok := m.peers[key]
	if !ok || !p.best.IsValid() || m.now().Sub(p.lastPong) > FreshFor {
		return netip.AddrPort{}, false
	}
	return p.best, true
}

// Tick sends due pings. Call it every second or so.
func (m *Manager) Tick() {
	type out struct {
		to  netip.AddrPort
		pkt []byte
	}
	var sends []out

	m.mu.Lock()
	now := m.now()
	for key, p := range m.peers {
		for tx, s := range p.pending {
			if now.Sub(s.at) > FreshFor {
				delete(p.pending, tx)
			}
		}
		for addr, at := range p.observed {
			if now.Sub(at) > 3*FreshFor {
				delete(p.observed, addr)
			}
		}
		confirmed := p.best.IsValid() && now.Sub(p.lastPong) <= FreshFor
		targets := append([]netip.AddrPort(nil), p.candidates...)
		for addr := range p.observed {
			if !containsAddr(targets, addr) {
				targets = append(targets, addr)
			}
		}
		// A confirmed path that missed a keepalive may be dead (the
		// peer moved): look for a new one while still using it.
		healthy := confirmed && now.Sub(p.lastPong) <= keepEvery+pingEvery
		every := pingEvery
		if healthy {
			// Keep the confirmed path alive, and follow the peer if it
			// pinged us from somewhere new since (its network changed).
			targets, every = []netip.AddrPort{p.best}, keepEvery
			for addr, at := range p.observed {
				if addr != p.best && at.After(p.lastPong) {
					targets = append(targets, addr)
				}
			}
		}
		if now.Sub(p.lastPing) < every {
			continue
		}
		p.lastPing = now
		for _, to := range targets {
			var tx txID
			_, _ = rand.Read(tx[:])
			pkt, err := m.seal(key, typePing, tx)
			if err != nil {
				continue
			}
			p.pending[tx] = sentPing{to: to, at: now}
			sends = append(sends, out{to, pkt})
		}
	}
	m.mu.Unlock()

	for _, s := range sends {
		_ = m.send(s.to, s.pkt)
	}
}

// Handle processes a disco packet received from `from`. Returns false if b is
// not a disco packet (it belongs to WireGuard).
func (m *Manager) Handle(b []byte, from netip.AddrPort) bool {
	if !Is(b) {
		return false
	}
	sender, typ, tx, ok := m.open(b)
	if !ok {
		return true // disco, but forged or not for us: drop
	}

	m.mu.Lock()
	p, known := m.peers[sender]
	if !known {
		m.mu.Unlock()
		return true // only talk to peers in our network map
	}
	switch typ {
	case typePing:
		_, seen := p.observed[from]
		p.observed[from] = m.now()
		if !seen && !containsAddr(p.candidates, from) {
			p.lastPing = time.Time{} // ping the new address right away
		}
		m.mu.Unlock()
		if pong, err := m.seal(sender, typePong, tx); err == nil {
			_ = m.send(from, pong)
		}
		return true
	case typePong:
		if _, ok := p.pending[tx]; ok {
			delete(p.pending, tx)
			// The address the pong came from is the one that works,
			// whatever we sent to (NATs can rewrite ports).
			p.best = from
			p.lastPong = m.now()
		}
	}
	m.mu.Unlock()
	return true
}

func (m *Manager) seal(to Key, typ byte, tx txID) ([]byte, error) {
	var nonce [24]byte
	if _, err := rand.Read(nonce[:]); err != nil {
		return nil, err
	}
	payload := append([]byte{typ}, tx[:]...)
	toKey := [32]byte(to)
	out := make([]byte, 0, headerLen+len(payload)+box.Overhead)
	out = append(out, magic...)
	out = append(out, m.public[:]...)
	out = append(out, nonce[:]...)
	return box.Seal(out, payload, &nonce, &toKey, &m.private), nil
}

func (m *Manager) open(b []byte) (sender Key, typ byte, tx txID, ok bool) {
	copy(sender[:], b[6:38])
	var nonce [24]byte
	copy(nonce[:], b[38:62])
	senderKey := [32]byte(sender)
	payload, ok := box.Open(nil, b[headerLen:], &nonce, &senderKey, &m.private)
	if !ok || len(payload) != 13 {
		return sender, 0, tx, false
	}
	copy(tx[:], payload[1:])
	return sender, payload[0], tx, true
}

func containsAddr(list []netip.AddrPort, addr netip.AddrPort) bool {
	for _, a := range list {
		if a == addr {
			return true
		}
	}
	return false
}
