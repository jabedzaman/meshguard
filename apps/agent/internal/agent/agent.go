// Package agent implements the device daemon: the local API the desktop app
// and CLI use, and the loop that keeps WireGuard in step with the control plane.
package agent

import (
	"context"
	"encoding/base64"
	"errors"
	"log/slog"
	"net/netip"
	"runtime"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/jabedzaman/meshguard/internal/coordination"
	"github.com/jabedzaman/meshguard/internal/disco"
	"github.com/jabedzaman/meshguard/internal/discovery"
	"github.com/jabedzaman/meshguard/internal/dns"
	"github.com/jabedzaman/meshguard/internal/ipc"
	"github.com/jabedzaman/meshguard/internal/relay"
	"github.com/jabedzaman/meshguard/internal/state"
	"github.com/jabedzaman/meshguard/internal/stun"
	"github.com/jabedzaman/meshguard/internal/wireguard"
)

// Engine is the WireGuard device; an interface so tests can fake it.
type Engine interface {
	Name() string
	SetPeers([]wireguard.Peer) (changed bool, err error)
	Stats() (map[string]wireguard.PeerStats, error)
	SetRelay(wireguard.RelaySender)
	DeliverRelay(relay.Packet)
	SetInterceptor(wireguard.Interceptor)
	SendTo(netip.AddrPort, []byte) error
	Rebind() error
	Close()
}

// Agent serves the local API and owns the device's state and WireGuard.
type Agent struct {
	Version  string
	StateDir string
	// WireGuard UDP port. Default 51820.
	ListenPort int
	// Requested interface name. Default "meshguard0" ("utun" on macOS).
	InterfaceName string
	// How often to sync with the control plane. Default 10s.
	SyncInterval time.Duration
	// Creates the WireGuard engine. Default wireguard.Start.
	StartEngine func(wireguard.Config) (Engine, error)
	// How often to check for network changes and wake from sleep. Default 2s.
	NetCheckInterval time.Duration
	// UIDs allowed to use the local API besides root and the agent's own
	// user (the -socket-owner).
	Operators []uint32

	// linkState summarizes the network attachment; a change means the
	// network changed. Default: the advertisable local addresses.
	linkState func(engine Engine, exclude []netip.Prefix) string
	// dnsListen replaces dns.ListenAddr and skips OS resolver setup (tests).
	dnsListen netip.AddrPort

	mu   sync.Mutex // guards ctx and conn, and serializes up/down/logout
	ctx  context.Context
	conn *connection // nil when not connected

	// nat has its own lock: the interceptor runs on WireGuard's receive goroutines.
	nat natState
}

// connection is everything that exists only while the device is connected:
// WireGuard, the sync loop, the relay and hole punching. Fields are guarded
// by Agent.mu. down/logout cancel it; up starts a new one.
type connection struct {
	ctx    context.Context
	cancel context.CancelFunc
	// syncNow asks the loop to sync right away (after a network change).
	syncNow chan struct{}

	engine   Engine // nil if WireGuard couldn't start (problem says why)
	disco    *disco.Manager
	problem  string
	lastSync time.Time
	peers    []coordination.Peer
	stun     []string

	relayClient *relay.Client
	relayURL    string
	stopRelay   context.CancelFunc

	dns dnsState
}

// Run starts connecting if the device is enrolled (and not down), then blocks
// until ctx is done and tears WireGuard down.
func (a *Agent) Run(ctx context.Context) {
	a.mu.Lock()
	a.ctx = ctx
	if st, err := state.Load(a.StateDir); err == nil && !st.Disabled {
		a.startLocked(st)
	}
	a.mu.Unlock()

	<-ctx.Done()

	a.mu.Lock()
	a.stopLocked()
	a.mu.Unlock()
}

// startLocked brings up WireGuard (if possible) and starts syncing.
func (a *Agent) startLocked(st *state.State) {
	if a.conn != nil || a.ctx == nil {
		return
	}
	ctx, cancel := context.WithCancel(a.ctx)
	c := &connection{ctx: ctx, cancel: cancel, syncNow: make(chan struct{}, 1)}
	a.conn = c

	cfg, err := a.engineConfig(st)
	if err == nil {
		c.engine, err = a.startEngine()(cfg)
	}
	if err != nil {
		c.engine = nil // never keep a half-made engine, even a typed nil
		// Keep syncing so the device shows as online; explain in status.
		c.problem = "WireGuard is not running: " + err.Error()
		slog.Warn("wireguard unavailable", "err", err)
	} else {
		a.startHolePunching(c, st)
		a.startDNSLocked(c, st)
		go a.watchNetwork(c, st)
	}
	go a.loop(c, st)
}

// stopLocked tears the connection down; the device stays enrolled.
func (a *Agent) stopLocked() {
	c := a.conn
	if c == nil {
		return
	}
	a.conn = nil
	c.cancel() // stops the loop, relay, disco ticker and DNS server
	a.stopDNSLocked(c)
	if c.engine != nil {
		c.engine.Close()
	}
	a.nat.reset()
	slog.Info("disconnected")
}

// current reports whether c is still the live connection. Caller holds a.mu.
func (a *Agent) current(c *connection) bool { return a.conn == c && c.ctx.Err() == nil }

// startHolePunching routes STUN and disco packets out of WireGuard's socket
// and pings peers' candidate endpoints every second.
func (a *Agent) startHolePunching(c *connection, st *state.State) {
	keys, err := st.Keys()
	if err != nil {
		return
	}
	public, err := relay.PublicKey(keys.WireGuard)
	if err != nil {
		return
	}
	d := disco.NewManager(keys.WireGuard, disco.Key(public), c.engine.SendTo)
	c.disco = d
	c.engine.SetInterceptor(func(packet []byte, from netip.AddrPort) bool {
		if stun.Is(packet) {
			a.nat.handle(packet)
			return true
		}
		return d.Handle(packet, from)
	})
	go func() {
		ticker := time.NewTicker(time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-c.ctx.Done():
				return
			case <-ticker.C:
				d.Tick()
			}
		}
	}()
}

func (a *Agent) startEngine() func(wireguard.Config) (Engine, error) {
	if a.StartEngine != nil {
		return a.StartEngine
	}
	return func(cfg wireguard.Config) (Engine, error) {
		e, err := wireguard.Start(cfg)
		if err != nil {
			// Return an untyped nil: a nil *wireguard.Engine in the Engine
			// interface would compare non-nil and crash on first use.
			return nil, err
		}
		return e, nil
	}
}

func (a *Agent) listenPort() int {
	if a.ListenPort != 0 {
		return a.ListenPort
	}
	return 51820
}

func (a *Agent) engineConfig(st *state.State) (wireguard.Config, error) {
	keys, err := st.Keys()
	if err != nil {
		return wireguard.Config{}, err
	}
	name := a.InterfaceName
	if name == "" {
		name = "meshguard0"
		if runtime.GOOS == "darwin" {
			name = "utun"
		}
	}
	var addresses []netip.Prefix
	for _, pair := range [][2]string{
		{st.Device.MeshIPv4, st.Network.IPv4CIDR},
		{st.Device.MeshIPv6, st.Network.IPv6CIDR},
	} {
		ip, err1 := netip.ParseAddr(pair[0])
		network, err2 := netip.ParsePrefix(pair[1])
		if err1 == nil && err2 == nil {
			addresses = append(addresses, netip.PrefixFrom(ip, network.Bits()))
		}
	}
	return wireguard.Config{
		InterfaceName: name,
		ListenPort:    a.listenPort(),
		PrivateKey:    keys.WireGuard,
		Addresses:     addresses,
	}, nil
}

// client returns a control plane client signing as this device.
func client(st *state.State) (*coordination.Client, *stateKeys, error) {
	keys, err := st.Keys()
	if err != nil {
		return nil, nil, err
	}
	cl := coordination.NewClient(st.ServerURL)
	cl.Signer = &coordination.Signer{DeviceID: st.Device.ID, Key: keys.Identity}
	return cl, &stateKeys{wireguard: keys.WireGuard}, nil
}

type stateKeys struct{ wireguard [32]byte }

func (a *Agent) loop(c *connection, st *state.State) {
	interval := a.SyncInterval
	if interval == 0 {
		interval = 10 * time.Second
	}
	cl, keys, err := client(st)
	if err != nil {
		a.setProblem(c, "cannot read keys: "+err.Error())
		return
	}

	exclude := meshPrefixes(st)
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		a.syncOnce(c, cl, exclude, keys.wireguard)
		select {
		case <-c.ctx.Done():
			return
		case <-ticker.C:
		case <-c.syncNow:
			ticker.Reset(interval)
		}
	}
}

// meshPrefixes are the network's mesh ranges, never advertised as endpoints.
func meshPrefixes(st *state.State) []netip.Prefix {
	var prefixes []netip.Prefix
	for _, cidr := range []string{st.Network.IPv4CIDR, st.Network.IPv6CIDR} {
		if p, err := netip.ParsePrefix(cidr); err == nil {
			prefixes = append(prefixes, p)
		}
	}
	return prefixes
}

// endpoints returns the addresses to advertise: local first, then the public
// one STUN reported. Empty without WireGuard listening.
func (a *Agent) endpoints(engine Engine, exclude []netip.Prefix) []string {
	endpoints := []string{}
	if engine == nil {
		return endpoints
	}
	endpoints = append(endpoints, discovery.Endpoints(a.listenPort(), engine.Name(), exclude)...)
	if public, ok := a.nat.publicEndpoint(); ok && !slices.Contains(endpoints, public.String()) {
		endpoints = append(endpoints, public.String())
	}
	return endpoints
}

func (a *Agent) syncOnce(c *connection, cl *coordination.Client, exclude []netip.Prefix, wgPrivate [32]byte) {
	a.mu.Lock()
	engine := c.engine
	d := c.disco
	a.mu.Unlock()

	syncCtx, cancel := context.WithTimeout(c.ctx, 15*time.Second)
	defer cancel()
	nm, err := cl.Sync(syncCtx, coordination.SyncRequest{Endpoints: a.endpoints(engine, exclude)})
	if err != nil {
		if c.ctx.Err() == nil {
			slog.Warn("sync failed", "err", err)
			a.setProblem(c, "cannot reach the control plane: "+err.Error())
		}
		return
	}

	var applyErr error
	if engine != nil {
		relayOn := a.ensureRelay(c, nm.Relay, wgPrivate)
		a.probeStun(engine, nm.Stun)
		if d != nil {
			d.SetPeers(discoCandidates(nm.Peers))
		}
		local := discovery.LocalPrefixes(engine.Name())
		peers := make([]wireguard.Peer, 0, len(nm.Peers))
		for _, p := range nm.Peers {
			peer := wireguard.Peer{PublicKey: p.WireGuardPublicKey}
			for _, addr := range []string{p.MeshIPv4, p.MeshIPv6} {
				if prefix, err := wireguard.HostPrefix(addr); err == nil {
					peer.AllowedIPs = append(peer.AllowedIPs, prefix)
				}
			}
			peer.Endpoint = chooseEndpoint(p, local, punched(d, p), relayOn)
			peers = append(peers, peer)
		}
		changed, err := engine.SetPeers(peers)
		applyErr = err
		if changed {
			slog.Info("peers updated", "count", len(peers))
		}
	}

	a.mu.Lock()
	defer a.mu.Unlock()
	if !a.current(c) {
		return // disconnected while syncing
	}
	c.lastSync = time.Now()
	c.peers = nm.Peers
	c.stun = nm.Stun
	a.updateDNSLocked(c, nm)
	a.saveNameLocked(nm.Self.Name)
	switch {
	case applyErr != nil:
		c.problem = "cannot apply peers: " + applyErr.Error()
	case c.engine != nil:
		c.problem = ""
	}
}

func discoCandidates(peers []coordination.Peer) map[disco.Key][]netip.AddrPort {
	candidates := map[disco.Key][]netip.AddrPort{}
	for _, p := range peers {
		key, err := peerKey(p.WireGuardPublicKey)
		if err != nil {
			continue
		}
		var eps []netip.AddrPort
		for _, ep := range p.Endpoints {
			if ap, err := netip.ParseAddrPort(ep); err == nil {
				eps = append(eps, ap)
			}
		}
		candidates[disco.Key(key)] = eps
	}
	return candidates
}

// punched returns the hole-punched direct path to p confirmed by disco, if any.
func punched(d *disco.Manager, p coordination.Peer) string {
	if d == nil {
		return ""
	}
	key, err := peerKey(p.WireGuardPublicKey)
	if err != nil {
		return ""
	}
	if addr, ok := d.Direct(disco.Key(key)); ok {
		return addr.String()
	}
	return ""
}

// chooseEndpoint picks how to reach a peer: an address on a network we're
// attached to, then a hole-punched path confirmed by disco, then the relay,
// and as a last resort its first advertised endpoint.
func chooseEndpoint(p coordination.Peer, local []netip.Prefix, punched string, relayOn bool) string {
	if direct := discovery.DirectEndpoint(p.Endpoints, local); direct != "" {
		return direct
	}
	if punched != "" {
		return punched
	}
	if relayOn {
		if key, err := peerKey(p.WireGuardPublicKey); err == nil {
			return wireguard.RelayEndpointString(key)
		}
	}
	if len(p.Endpoints) > 0 {
		return p.Endpoints[0]
	}
	return ""
}

func peerKey(b64 string) (relay.Key, error) {
	raw, err := base64.StdEncoding.DecodeString(b64)
	if err != nil || len(raw) != relay.KeyLen {
		return relay.Key{}, errors.New("invalid peer key")
	}
	return relay.Key(raw), nil
}

// ensureRelay keeps a relay connection matching the network map and wires it
// into WireGuard. Returns whether a relay is configured.
func (a *Agent) ensureRelay(c *connection, cfg *coordination.Relay, wgPrivate [32]byte) bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	if !a.current(c) || c.engine == nil {
		return false
	}

	url := ""
	if cfg != nil {
		url = cfg.URL
	}
	if url == c.relayURL {
		return url != ""
	}
	if c.stopRelay != nil {
		c.stopRelay()
		c.stopRelay, c.relayClient = nil, nil
		c.engine.SetRelay(nil)
	}
	c.relayURL = url
	if url == "" {
		return false
	}

	rc, err := relay.NewClient(url, wgPrivate)
	if err != nil {
		slog.Warn("relay client", "err", err)
		return false
	}
	rc.Deliver = c.engine.DeliverRelay
	relayCtx, cancel := context.WithCancel(c.ctx)
	c.engine.SetRelay(func(dst relay.Key, packet []byte) error {
		return rc.Send(relayCtx, dst, packet)
	})
	c.relayClient, c.stopRelay = rc, cancel
	go rc.Run(relayCtx)
	slog.Info("relay configured", "url", url)
	return true
}

func (a *Agent) setProblem(c *connection, p string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.current(c) {
		c.problem = p
	}
}

// statusLocked builds the status. Caller holds a.mu.
// saveNameLocked keeps the saved device name in step with the control plane,
// where it can be renamed. Caller holds a.mu.
func (a *Agent) saveNameLocked(name string) {
	if name == "" {
		return
	}
	st, err := state.Load(a.StateDir)
	if err != nil || st.Device.Name == name {
		return
	}
	old := st.Device.Name
	st.Device.Name = name
	if err := state.Save(a.StateDir, st); err != nil {
		slog.Warn("cannot save renamed device", "err", err)
		return
	}
	slog.Info("device renamed", "from", old, "to", name)
}

func (a *Agent) statusLocked(st *state.State) ipc.Status {
	s := ipc.Status{
		Version: a.Version,
		State:   "enrolled",
		Server:  st.ServerURL,
		Device: &ipc.Device{
			ID: st.Device.ID, Name: st.Device.Name,
			MeshIPv4: st.Device.MeshIPv4, MeshIPv6: st.Device.MeshIPv6,
		},
		Network: &ipc.Network{ID: st.Network.ID, Name: st.Network.Name},
	}
	c := a.conn
	if st.Disabled || c == nil {
		if st.Disabled {
			s.State = "down"
		}
		return s
	}
	s.Problem = c.problem
	if !c.lastSync.IsZero() {
		at := c.lastSync
		s.LastSyncAt = &at
	}
	if c.relayClient != nil {
		s.Relay = &ipc.RelayStatus{URL: c.relayURL, Connected: c.relayClient.Connected()}
	}
	if public, ok := a.nat.publicEndpoint(); ok {
		s.PublicEndpoint = public.String()
	}
	var stats map[string]wireguard.PeerStats
	if c.engine != nil {
		dnsStatus := c.dns.status
		s.DNS = &dnsStatus
		s.Interface = c.engine.Name()
		stats, _ = c.engine.Stats()
		if c.problem == "" && !c.lastSync.IsZero() {
			s.State = "connected"
		}
	}
	for _, p := range c.peers {
		peer := ipc.Peer{Name: p.Name, DNSName: dns.Name(p.Name), MeshIPv4: p.MeshIPv4, MeshIPv6: p.MeshIPv6}
		if hexKey, err := wireguard.KeyToHex(p.WireGuardPublicKey); err == nil {
			if ps, ok := stats[hexKey]; ok {
				peer.Endpoint = ps.Endpoint
				peer.ViaRelay = strings.HasPrefix(ps.Endpoint, wireguard.RelayEndpointPrefix)
				if !ps.LastHandshake.IsZero() {
					hs := ps.LastHandshake
					peer.LastHandshake = &hs
				}
			}
		}
		s.Peers = append(s.Peers, peer)
	}
	return s
}
