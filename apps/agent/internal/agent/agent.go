// Package agent implements the device daemon: the local API the desktop app
// and CLI use, and the loop that keeps WireGuard in step with the control plane.
package agent

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"net/netip"
	"os"
	"regexp"
	"runtime"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/twinlabshq/mesh/internal/coordination"
	"github.com/twinlabshq/mesh/internal/disco"
	"github.com/twinlabshq/mesh/internal/discovery"
	"github.com/twinlabshq/mesh/internal/identity"
	"github.com/twinlabshq/mesh/internal/ipc"
	"github.com/twinlabshq/mesh/internal/relay"
	"github.com/twinlabshq/mesh/internal/state"
	"github.com/twinlabshq/mesh/internal/stun"
	"github.com/twinlabshq/mesh/internal/wireguard"
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
	Close()
}

// Agent serves the local API and owns the device's state and WireGuard.
type Agent struct {
	Version  string
	StateDir string
	// WireGuard UDP port. Default 51820.
	ListenPort int
	// Requested interface name. Default "mesh0" ("utun" on macOS).
	InterfaceName string
	// How often to sync with the control plane. Default 10s.
	SyncInterval time.Duration
	// Creates the WireGuard engine. Default wireguard.Start.
	StartEngine func(wireguard.Config) (Engine, error)

	mu       sync.Mutex // guards everything below and serializes enrollment
	ctx      context.Context
	running  bool
	engine   Engine
	problem  string
	lastSync time.Time
	peers    []coordination.Peer

	relayClient *relay.Client
	relayURL    string
	stopRelay   context.CancelFunc

	// Hole punching. disco is set once WireGuard is up; nat has its own lock
	// because the interceptor runs on WireGuard's receive goroutines.
	disco *disco.Manager
	nat   natState
}

// natState is what STUN told us about our public address.
type natState struct {
	mu       sync.Mutex
	pending  map[stun.TxID]time.Time
	public   netip.AddrPort
	publicAt time.Time
}

// stunFreshFor is how long a STUN result is advertised without a new answer.
const stunFreshFor = time.Minute

func (n *natState) handle(packet []byte) {
	tx, addr, err := stun.ParseResponse(packet)
	if err != nil {
		return
	}
	n.mu.Lock()
	defer n.mu.Unlock()
	if _, ok := n.pending[tx]; ok {
		delete(n.pending, tx)
		n.public, n.publicAt = addr, time.Now()
	}
}

func (n *natState) publicEndpoint() (netip.AddrPort, bool) {
	n.mu.Lock()
	defer n.mu.Unlock()
	return n.public, n.public.IsValid() && time.Since(n.publicAt) < stunFreshFor
}

func (n *natState) newRequest() []byte {
	tx, req := stun.Request()
	n.mu.Lock()
	defer n.mu.Unlock()
	if n.pending == nil {
		n.pending = map[stun.TxID]time.Time{}
	}
	for old, at := range n.pending {
		if time.Since(at) > 30*time.Second {
			delete(n.pending, old)
		}
	}
	n.pending[tx] = time.Now()
	return req
}

// Run starts the background loop if the device is already enrolled, then
// blocks until ctx is done and tears WireGuard down.
func (a *Agent) Run(ctx context.Context) {
	a.mu.Lock()
	a.ctx = ctx
	if st, err := state.Load(a.StateDir); err == nil {
		a.startLocked(st)
	}
	a.mu.Unlock()

	<-ctx.Done()

	a.mu.Lock()
	defer a.mu.Unlock()
	if a.engine != nil {
		a.engine.Close()
		a.engine = nil
	}
}

// startLocked brings up WireGuard (if possible) and starts syncing. Caller holds a.mu.
func (a *Agent) startLocked(st *state.State) {
	if a.running || a.ctx == nil {
		return
	}
	a.running = true

	cfg, err := a.engineConfig(st)
	if err == nil {
		a.engine, err = a.startEngine()(cfg)
	}
	if err == nil {
		a.startHolePunchingLocked(st)
	}
	if err != nil {
		a.engine = nil // never keep a half-made engine, even a typed nil
		// Keep syncing so the device shows as online; explain in status.
		a.problem = "WireGuard is not running: " + err.Error()
		slog.Warn("wireguard unavailable", "err", err)
	}
	go a.loop(a.ctx, st)
}

// startHolePunchingLocked routes STUN and disco packets out of WireGuard's
// socket and pings peers' candidate endpoints every second. Caller holds a.mu.
func (a *Agent) startHolePunchingLocked(st *state.State) {
	keys, err := st.Keys()
	if err != nil {
		return
	}
	public, err := relay.PublicKey(keys.WireGuard)
	if err != nil {
		return
	}
	engine := a.engine
	d := disco.NewManager(keys.WireGuard, disco.Key(public), engine.SendTo)
	a.disco = d
	engine.SetInterceptor(func(packet []byte, from netip.AddrPort) bool {
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
			case <-a.ctx.Done():
				return
			case <-ticker.C:
				d.Tick()
			}
		}
	}()
}

// probeStun asks each STUN server for our public address, from WireGuard's
// socket. Answers arrive through the interceptor and are used next sync.
func (a *Agent) probeStun(engine Engine, servers []string) {
	for _, server := range servers {
		addr, err := net.ResolveUDPAddr("udp4", server)
		if err != nil {
			continue
		}
		ap := addr.AddrPort()
		_ = engine.SendTo(netip.AddrPortFrom(ap.Addr().Unmap(), ap.Port()), a.nat.newRequest())
	}
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
		name = "mesh0"
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

func (a *Agent) loop(ctx context.Context, st *state.State) {
	interval := a.SyncInterval
	if interval == 0 {
		interval = 10 * time.Second
	}
	keys, err := st.Keys()
	if err != nil {
		a.setProblem("cannot read keys: " + err.Error())
		return
	}
	client := coordination.NewClient(st.ServerURL)
	client.Signer = &coordination.Signer{DeviceID: st.Device.ID, Key: keys.Identity}

	var exclude []netip.Prefix
	for _, cidr := range []string{st.Network.IPv4CIDR, st.Network.IPv6CIDR} {
		if p, err := netip.ParsePrefix(cidr); err == nil {
			exclude = append(exclude, p)
		}
	}

	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		a.syncOnce(ctx, client, exclude, keys.WireGuard)
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (a *Agent) syncOnce(ctx context.Context, client *coordination.Client, exclude []netip.Prefix, wgPrivate [32]byte) {
	a.mu.Lock()
	engine := a.engine
	a.mu.Unlock()

	var endpoints []string
	if engine != nil {
		// Only advertise endpoints when WireGuard is actually listening:
		// local addresses first, then the public one STUN reported.
		endpoints = discovery.Endpoints(a.listenPort(), engine.Name(), exclude)
		if public, ok := a.nat.publicEndpoint(); ok && !slices.Contains(endpoints, public.String()) {
			endpoints = append(endpoints, public.String())
		}
	}
	if endpoints == nil {
		endpoints = []string{}
	}

	syncCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	nm, err := client.Sync(syncCtx, coordination.SyncRequest{Endpoints: endpoints})
	if err != nil {
		if ctx.Err() == nil {
			slog.Warn("sync failed", "err", err)
			a.setProblem("cannot reach the control plane: " + err.Error())
		}
		return
	}

	var applyErr error
	if engine != nil {
		relayOn := a.ensureRelay(ctx, nm.Relay, engine, wgPrivate)
		a.probeStun(engine, nm.Stun)
		a.mu.Lock()
		d := a.disco
		a.mu.Unlock()
		if d != nil {
			candidates := map[disco.Key][]netip.AddrPort{}
			for _, p := range nm.Peers {
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
			d.SetPeers(candidates)
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
	a.lastSync = time.Now()
	a.peers = nm.Peers
	switch {
	case applyErr != nil:
		a.problem = "cannot apply peers: " + applyErr.Error()
	case a.engine != nil:
		a.problem = ""
	}
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
func (a *Agent) ensureRelay(ctx context.Context, cfg *coordination.Relay, engine Engine, wgPrivate [32]byte) bool {
	a.mu.Lock()
	defer a.mu.Unlock()

	url := ""
	if cfg != nil {
		url = cfg.URL
	}
	if url == a.relayURL {
		return url != ""
	}
	if a.stopRelay != nil {
		a.stopRelay()
		a.stopRelay, a.relayClient = nil, nil
		engine.SetRelay(nil)
	}
	a.relayURL = url
	if url == "" {
		return false
	}

	client, err := relay.NewClient(url, wgPrivate)
	if err != nil {
		slog.Warn("relay client", "err", err)
		return false
	}
	client.Deliver = engine.DeliverRelay
	relayCtx, cancel := context.WithCancel(ctx)
	engine.SetRelay(func(dst relay.Key, packet []byte) error {
		return client.Send(relayCtx, dst, packet)
	})
	a.relayClient, a.stopRelay = client, cancel
	go client.Run(relayCtx)
	slog.Info("relay configured", "url", url)
	return true
}

func (a *Agent) setProblem(p string) {
	a.mu.Lock()
	a.problem = p
	a.mu.Unlock()
}

// Handler returns the local API routes.
func (a *Agent) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /v1/status", a.handleStatus)
	mux.HandleFunc("POST /v1/up", a.handleUp)
	return mux
}

func (a *Agent) handleStatus(w http.ResponseWriter, _ *http.Request) {
	a.mu.Lock()
	defer a.mu.Unlock()

	st, err := state.Load(a.StateDir)
	if errors.Is(err, state.ErrNotEnrolled) {
		writeJSON(w, http.StatusOK, ipc.Status{Version: a.Version, State: "not_enrolled"})
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "state_unreadable", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, a.statusLocked(st))
}

func (a *Agent) handleUp(w http.ResponseWriter, r *http.Request) {
	var req ipc.UpRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Token == "" || req.Server == "" {
		writeError(w, http.StatusBadRequest, "bad_request", "token and server are required")
		return
	}

	a.mu.Lock()
	defer a.mu.Unlock()

	if st, err := state.Load(a.StateDir); err == nil {
		writeError(w, http.StatusConflict, "already_enrolled",
			"this machine is already in network "+st.Network.Name+" as "+st.Device.Name)
		return
	}

	keys, err := identity.Generate()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "key_generation_failed", err.Error())
		return
	}
	wgPublic, err := keys.WireGuardPublicKey()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "key_generation_failed", err.Error())
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	res, err := coordination.NewClient(req.Server).Enroll(ctx, coordination.EnrollRequest{
		Token:              req.Token,
		Hostname:           hostname(),
		Platform:           runtime.GOOS,
		IdentityPublicKey:  keys.IdentityPublicKey(),
		WireGuardPublicKey: wgPublic,
	})
	var apiErr *coordination.Error
	if errors.As(err, &apiErr) {
		writeError(w, http.StatusBadGateway, apiErr.Code, apiErr.Message)
		return
	}
	if err != nil {
		writeError(w, http.StatusBadGateway, "control_plane_unreachable", err.Error())
		return
	}

	st := state.New(req.Server, keys, res.Device, res.Network)
	if err := state.Save(a.StateDir, st); err != nil {
		// Enrolled on the server but couldn't persist the keys: the device
		// record is unusable; surface it rather than pretend success.
		writeError(w, http.StatusInternalServerError, "state_unwritable", err.Error())
		return
	}
	slog.Info("enrolled", "device", st.Device.Name, "network", st.Network.Name, "ipv4", st.Device.MeshIPv4)
	a.startLocked(st)
	writeJSON(w, http.StatusOK, a.statusLocked(st))
}

// statusLocked builds the status. Caller holds a.mu.
func (a *Agent) statusLocked(st *state.State) ipc.Status {
	s := ipc.Status{
		Version: a.Version,
		State:   "enrolled",
		Problem: a.problem,
		Server:  st.ServerURL,
		Device: &ipc.Device{
			ID: st.Device.ID, Name: st.Device.Name,
			MeshIPv4: st.Device.MeshIPv4, MeshIPv6: st.Device.MeshIPv6,
		},
		Network: &ipc.Network{ID: st.Network.ID, Name: st.Network.Name},
	}
	if !a.lastSync.IsZero() {
		at := a.lastSync
		s.LastSyncAt = &at
	}
	if a.relayClient != nil {
		s.Relay = &ipc.RelayStatus{URL: a.relayURL, Connected: a.relayClient.Connected()}
	}
	if public, ok := a.nat.publicEndpoint(); ok {
		s.PublicEndpoint = public.String()
	}
	var stats map[string]wireguard.PeerStats
	if a.engine != nil {
		s.Interface = a.engine.Name()
		stats, _ = a.engine.Stats()
		if a.problem == "" && !a.lastSync.IsZero() {
			s.State = "connected"
		}
	}
	for _, p := range a.peers {
		peer := ipc.Peer{Name: p.Name, MeshIPv4: p.MeshIPv4, MeshIPv6: p.MeshIPv6}
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

var invalidHostnameChars = regexp.MustCompile(`[^A-Za-z0-9.-]+`)

// hostname returns the machine's short name (first label, so macOS's
// "Jabeds-MacBook-Air.local" becomes "Jabeds-MacBook-Air") in the form the
// control plane accepts.
func hostname() string {
	name, err := os.Hostname()
	if err != nil {
		name = "device"
	}
	return deviceName(name)
}

func deviceName(host string) string {
	name, _, _ := strings.Cut(host, ".")
	name = strings.Trim(invalidHostnameChars.ReplaceAllString(name, "-"), "-.")
	if name == "" {
		return "device"
	}
	return name
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, ipc.Error{Code: code, Message: message})
}
