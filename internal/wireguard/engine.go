package wireguard

import (
	"bufio"
	"encoding/hex"
	"fmt"
	"log/slog"
	"net/netip"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.zx2c4.com/wireguard/conn"
	"golang.zx2c4.com/wireguard/device"
	"golang.zx2c4.com/wireguard/tun"

	"github.com/jabedzaman/meshguard/internal/acl"
	"github.com/jabedzaman/meshguard/internal/relay"
)

// MTU leaves room for WireGuard's overhead on a 1500-byte path, plus IPv6.
const MTU = 1280

// Config describes the local interface.
type Config struct {
	// Requested TUN name ("meshguard0" on Linux; macOS always assigns "utunN").
	InterfaceName string
	ListenPort    int
	PrivateKey    [32]byte
	// The device's mesh addresses with the network's prefix length, e.g.
	// 10.77.4.9/16 and fd12:3456:789a:0:..../48, so the whole network routes
	// through the interface.
	Addresses []netip.Prefix
}

// Engine is a running WireGuard interface.
type Engine struct {
	name string
	tun  *filteredTUN
	dev  *device.Device
	bind *Bind
	// Access rules for packets from peers.
	filter *acl.Filter

	mu    sync.Mutex
	peers []Peer // as last applied
	// Subnet routes installed in the OS (accepted from peers) and served to them.
	accepted, served, servedMesh []netip.Prefix
	// exit: all other traffic goes through the mesh interface.
	exit bool
}

// Start creates the TUN interface, brings up WireGuard and configures
// addresses and routes. Needs root (CAP_NET_ADMIN on Linux). Nothing from
// peers is let in, except replies, until SetACL.
func Start(cfg Config) (*Engine, error) {
	t, err := tun.CreateTUN(cfg.InterfaceName, MTU)
	if err != nil {
		return nil, fmt.Errorf("create tun %q (needs root): %w", cfg.InterfaceName, err)
	}
	name, err := t.Name()
	if err != nil {
		t.Close()
		return nil, err
	}

	logger := device.NewLogger(device.LogLevelError, "wireguard: ")
	bind := NewBind(conn.NewDefaultBind())
	filter := acl.NewFilter(acl.Policy{})
	ft := &filteredTUN{Device: t, filter: filter, guard: newForwardGuard()}
	for _, a := range cfg.Addresses {
		if a.Addr().Is4() {
			ft.nat = newVIPNAT(a.Addr())
		}
	}
	dev := device.NewDevice(ft, bind, logger)
	// Peers are peer/<key> endpoints routed by the bind; never let WireGuard
	// swap one for the raw address a packet arrived from.
	dev.DisableSomeRoamingForBrokenMobileSemantics()
	base := fmt.Sprintf("private_key=%s\nlisten_port=%d\n", hex.EncodeToString(cfg.PrivateKey[:]), cfg.ListenPort) + markConfig()
	if err := dev.IpcSet(base); err != nil {
		dev.Close()
		return nil, fmt.Errorf("configure wireguard: %w", err)
	}
	if err := dev.Up(); err != nil {
		dev.Close()
		return nil, fmt.Errorf("bring up wireguard: %w", err)
	}
	if err := configureInterface(name, cfg.Addresses); err != nil {
		dev.Close()
		return nil, fmt.Errorf("configure %s: %w", name, err)
	}
	slog.Info("wireguard up", "interface", name, "port", cfg.ListenPort, "addresses", cfg.Addresses)
	return &Engine{name: name, tun: ft, dev: dev, bind: bind, filter: filter}, nil
}

// SetRelay sets how packets for peer/<key> endpoints go through the relay.
func (e *Engine) SetRelay(send RelaySender) { e.bind.SetRelay(send) }

// SetRouter sets which direct address, if any, peer/<key> packets use.
func (e *Engine) SetRouter(r Router) { e.bind.SetRouter(r) }

// SetInterceptor sees UDP packets before WireGuard (STUN, disco).
func (e *Engine) SetInterceptor(i Interceptor) { e.bind.SetInterceptor(i) }

// SendTo sends a raw packet from WireGuard's UDP socket.
func (e *Engine) SendTo(to netip.AddrPort, packet []byte) error { return e.bind.SendTo(to, packet) }

// DeliverRelay hands a packet received from the relay to WireGuard.
func (e *Engine) DeliverRelay(p relay.Packet) { e.bind.Deliver(p) }

// Rebind reopens the UDP sockets and forgets cached source addresses. Call it
// after a network change or wake from sleep, when old sockets may be stale.
func (e *Engine) Rebind() error { return e.dev.BindUpdate() }

// SetACL replaces the access rules for packets from peers.
func (e *Engine) SetACL(p acl.Policy) { e.filter.SetPolicy(p) }

// SetServiceAddresses makes this device answer for the service addresses it
// hosts: peers' packets to them are delivered to the device itself, and its
// replies leave from the address.
func (e *Engine) SetServiceAddresses(vips []netip.Addr) {
	if e.tun.nat != nil {
		e.tun.nat.set(vips)
	}
}

// InjectToOS hands an IP packet to the OS as if a peer had sent it.
func (e *Engine) InjectToOS(packet []byte) { e.tun.inject(packet) }

// SetForwardGuard limits what peers may send to addresses outside the mesh and
// served: nothing, except addresses passed to AllowForwardTo. Off for devices
// that don't connect domains for their peers.
func (e *Engine) SetForwardGuard(on bool, mesh, served []netip.Prefix) {
	e.tun.guard.configure(on, slices.Clone(mesh), slices.Clone(served))
}

// AllowForwardTo lets peers reach addrs for ttl (what the device resolved).
func (e *Engine) AllowForwardTo(addrs []netip.Addr, ttl time.Duration) {
	e.tun.guard.learn(addrs, ttl)
}

// SetLocalHandler answers packets for addresses the agent serves itself.
func (e *Engine) SetLocalHandler(h LocalHandler) { e.tun.local.Store(&h) }

// ACLDropped counts packets from peers the access rules refused.
func (e *Engine) ACLDropped() uint64 { return e.filter.Dropped() }

// Name is the actual interface name.
func (e *Engine) Name() string { return e.name }

// SetPeers makes the device's peers match. Existing peers keep their
// sessions. A no-op if nothing changed.
func (e *Engine) SetPeers(peers []Peer) (changed bool, err error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	uapi, err := PeersUAPI(e.peers, peers)
	if err != nil {
		return false, err
	}
	if uapi == "" {
		return false, nil
	}
	if err := e.dev.IpcSet(uapi); err != nil {
		return false, fmt.Errorf("set peers: %w", err)
	}
	logEndpointChanges(e.peers, peers)
	e.peers = append([]Peer(nil), peers...)
	return true, nil
}

// logEndpointChanges logs each peer whose path changed, e.g. relay to direct.
func logEndpointChanges(prev, next []Peer) {
	old := map[string]string{}
	for _, p := range prev {
		old[p.PublicKey] = p.Endpoint
	}
	for _, p := range next {
		if from, ok := old[p.PublicKey]; ok && from != p.Endpoint && p.Endpoint != "" {
			slog.Info("peer endpoint changed", "peer", shortKey(p.PublicKey), "from", from, "to", p.Endpoint)
		}
	}
}

// shortKey abbreviates a base64 key the way wireguard-go's logs do.
func shortKey(k string) string {
	if len(k) < 8 {
		return k
	}
	return k[:4] + "…" + k[len(k)-5:len(k)-1]
}

// PeerStats is the live state of one peer.
type PeerStats struct {
	PublicKey     string // hex
	Endpoint      string
	LastHandshake time.Time
	RxBytes       uint64
	TxBytes       uint64
}

// Stats reads per-peer state from the device.
func (e *Engine) Stats() (map[string]PeerStats, error) {
	raw, err := e.dev.IpcGet()
	if err != nil {
		return nil, err
	}
	return parseStats(raw), nil
}

func parseStats(raw string) map[string]PeerStats {
	stats := map[string]PeerStats{}
	var cur *PeerStats
	var sec, nsec int64
	flush := func() {
		if cur != nil {
			if sec > 0 {
				cur.LastHandshake = time.Unix(sec, nsec)
			}
			stats[cur.PublicKey] = *cur
		}
	}
	scanner := bufio.NewScanner(strings.NewReader(raw))
	for scanner.Scan() {
		k, v, ok := strings.Cut(scanner.Text(), "=")
		if !ok {
			continue
		}
		switch k {
		case "public_key":
			flush()
			cur, sec, nsec = &PeerStats{PublicKey: v}, 0, 0
		case "endpoint":
			if cur != nil {
				cur.Endpoint = v
			}
		case "last_handshake_time_sec":
			sec, _ = strconv.ParseInt(v, 10, 64)
		case "last_handshake_time_nsec":
			nsec, _ = strconv.ParseInt(v, 10, 64)
		case "rx_bytes":
			if cur != nil {
				cur.RxBytes, _ = strconv.ParseUint(v, 10, 64)
			}
		case "tx_bytes":
			if cur != nil {
				cur.TxBytes, _ = strconv.ParseUint(v, 10, 64)
			}
		}
	}
	flush()
	return stats
}

// Close tears down the device and interface.
func (e *Engine) Close() {
	e.closeRoutes()
	e.dev.Close()
}
