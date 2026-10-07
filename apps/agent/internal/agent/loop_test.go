package agent

import (
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jabedzaman/meshguard/internal/acl"
	"github.com/jabedzaman/meshguard/internal/coordination"
	"github.com/jabedzaman/meshguard/internal/ipc"
	"github.com/jabedzaman/meshguard/internal/relay"
	"github.com/jabedzaman/meshguard/internal/wireguard"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/net/dns/dnsmessage"
)

type fakeEngine struct {
	mu      sync.Mutex
	peers   []wireguard.Peer
	cfg     wireguard.Config
	acl     *acl.Policy
	rebinds atomic.Int32
	local   wireguard.LocalHandler
	router  wireguard.Router
	// subnet routes served to peers and accepted from them
	served, accepted []netip.Prefix
	exit             bool
}

func (e *fakeEngine) Name() string { return "meshguard-test0" }
func (e *fakeEngine) Close()       {}
func (e *fakeEngine) SetServedRoutes(routes, _ []netip.Prefix) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.served = routes
	return nil
}
func (e *fakeEngine) SetExitNode(on bool) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.exit = on
	return nil
}
func (e *fakeEngine) SetAcceptedRoutes(routes []netip.Prefix) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.accepted = routes
	return nil
}
func (e *fakeEngine) SetPeers(p []wireguard.Peer) (bool, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.peers = p
	return true, nil
}
func (e *fakeEngine) Stats() (map[string]wireguard.PeerStats, error) { return nil, nil }
func (e *fakeEngine) SetRelay(wireguard.RelaySender)                 {}
func (e *fakeEngine) DeliverRelay(relay.Packet)                      {}
func (e *fakeEngine) SetRouter(r wireguard.Router) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.router = r
}
func (e *fakeEngine) Router() wireguard.Router {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.router
}
func (e *fakeEngine) Config() wireguard.Config {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.cfg
}
func (e *fakeEngine) Peers() []wireguard.Peer {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.peers
}

// signedControlPlane enrolls one device and answers signed syncs with one peer.
// deletes counts DELETE /v1/devices/self calls on the last signedControlPlane.
var deletes *atomic.Int32

// selfName is the name the last signedControlPlane syncs for the device, so tests can rename it.
var selfName *atomic.Value

// watchable makes the last signedControlPlane send map revisions and answer
// watches (a revision is the device's name); watches counts them.
var watchable *atomic.Bool
var watches *atomic.Int32

func signedControlPlane(t *testing.T) (url string, syncs *atomic.Int32) {
	t.Helper()
	var mu sync.Mutex
	var identityKey ed25519.PublicKey
	var count atomic.Int32
	deletes = &atomic.Int32{}
	selfName = &atomic.Value{}
	selfName.Store("laptop")
	watchable, watches = &atomic.Bool{}, &atomic.Int32{}
	peerKey := base64.StdEncoding.EncodeToString(make([]byte, 32))

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		mu.Lock()
		defer mu.Unlock()
		switch r.URL.Path {
		case "/v1/devices/enroll":
			var req coordination.EnrollRequest
			require.NoError(t, json.Unmarshal(body, &req))
			raw, _ := base64.StdEncoding.DecodeString(req.IdentityPublicKey)
			identityKey = raw
			w.WriteHeader(http.StatusCreated)
			_, _ = w.Write([]byte(`{"device":{"id":"d1","name":"laptop","meshIpv4":"10.77.0.2","meshIpv6":"fd00:1:2:0::2"},"network":{"id":"n1","name":"home","ipv4Cidr":"10.77.0.0/16","ipv6Cidr":"fd00:1:2::/48"}}`))
		case "/v1/devices/self":
			if r.Method == http.MethodDelete && r.Header.Get(coordination.HeaderDevice) == "d1" {
				deletes.Add(1)
				w.WriteHeader(http.StatusNoContent)
				return
			}
			w.WriteHeader(http.StatusUnauthorized)
		case "/v1/devices/self/watch":
			if !watchable.Load() {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			var req struct{ Revision string }
			require.NoError(t, json.Unmarshal(body, &req))
			watches.Add(1)
			mu.Unlock()
			// Answer when the name changes, else after a short wait.
			changed := false
			for range 20 {
				if changed = selfName.Load().(string) != req.Revision; changed {
					break
				}
				time.Sleep(10 * time.Millisecond)
			}
			mu.Lock()
			_, _ = w.Write([]byte(fmt.Sprintf(`{"changed":%t}`, changed)))
		case "/v1/devices/self/sync":
			sig, _ := base64.StdEncoding.DecodeString(r.Header.Get(coordination.HeaderSignature))
			msg := coordination.SigningString(r.Method, r.URL.Path, r.Header.Get(coordination.HeaderTimestamp), r.Header.Get(coordination.HeaderNonce), body)
			if r.Header.Get(coordination.HeaderDevice) != "d1" || !ed25519.Verify(identityKey, []byte(msg), sig) {
				w.WriteHeader(http.StatusUnauthorized)
				_, _ = w.Write([]byte(`{"error":{"code":"invalid_device_signature","message":"Invalid device signature"}}`))
				return
			}
			count.Add(1)
			revision := ""
			if watchable.Load() {
				revision = selfName.Load().(string)
			}
			_, _ = w.Write([]byte(`{"revision":"` + revision + `","self":{"id":"d1","name":"` + selfName.Load().(string) + `","meshIpv4":"10.77.0.2"},"network":{"id":"n1","name":"home","dnsDomain":"brave-otter.mesh.jabed.dev"},"peers":[{"id":"d2","name":"server","wireguardPublicKey":"` + peerKey + `","meshIpv4":"10.77.0.3","meshIpv6":"fd00:1:2:0::3","endpoints":["192.168.1.9:51820","[2001:db8::9]:51820"]}]}`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(srv.Close)
	return srv.URL, &count
}

func TestUpStartsWireGuardAndSyncsPeers(t *testing.T) {
	server, _ := signedControlPlane(t)
	engine := &fakeEngine{}
	a := &Agent{
		Version:      "test",
		StateDir:     t.TempDir(),
		SyncInterval: 50 * time.Millisecond,
		StartEngine: func(cfg wireguard.Config) (Engine, error) {
			engine.mu.Lock()
			engine.cfg = cfg
			engine.mu.Unlock()
			return engine, nil
		},
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go a.Run(ctx)
	require.Eventually(t, func() bool { a.mu.Lock(); defer a.mu.Unlock(); return a.ctx != nil }, time.Second, 10*time.Millisecond)

	rec, _, _ := call(t, a.Handler(), http.MethodPost, "/v1/up", ipc.UpRequest{Token: "good", Server: server})
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())

	// Interface gets the mesh addresses with the network prefix lengths.
	require.Eventually(t, func() bool { return len(engine.Peers()) == 1 }, 2*time.Second, 20*time.Millisecond)
	cfg := engine.Config()
	assert.Equal(t, "10.77.0.2/16", cfg.Addresses[0].String())
	assert.Equal(t, "fd00:1:2::2/48", cfg.Addresses[1].String())
	assert.Equal(t, 51820, cfg.ListenPort)

	// Peer: addressed by key for the bind to route, host routes for both
	// mesh addresses.
	peer := engine.Peers()[0]
	hexKey, ok := strings.CutPrefix(peer.Endpoint, wireguard.PeerEndpointPrefix)
	require.True(t, ok, peer.Endpoint)
	raw, err := hex.DecodeString(hexKey)
	require.NoError(t, err)
	// Nothing confirmed and no relay: try the first advertised endpoint.
	addr, direct := engine.Router()(relay.Key(raw))
	assert.False(t, direct)
	assert.Equal(t, "192.168.1.9:51820", addr.String())
	require.Len(t, peer.AllowedIPs, 2)
	assert.Equal(t, "10.77.0.3/32", peer.AllowedIPs[0].String())
	assert.Equal(t, "fd00:1:2::3/128", peer.AllowedIPs[1].String())

	_, status, _ := call(t, a.Handler(), http.MethodGet, "/v1/status", nil)
	assert.Equal(t, "connected", status.State)
	assert.Empty(t, status.Problem)
	assert.Equal(t, "meshguard-test0", status.Interface)
	// A control plane that sends no access rules lets everything in.
	assert.Equal(t, &acl.AllowAllPolicy, engine.ACL())
	require.NotNil(t, status.ACL)
	assert.Equal(t, "allow", status.ACL.DefaultAction)
	require.Len(t, status.Peers, 1)
	assert.Equal(t, "server", status.Peers[0].Name)
}

func TestServesPeersOverDNS(t *testing.T) {
	server, _ := signedControlPlane(t)
	engine := &fakeEngine{}
	a := &Agent{
		Version:      "test",
		StateDir:     t.TempDir(),
		SyncInterval: 50 * time.Millisecond,
		StartEngine:  func(wireguard.Config) (Engine, error) { return engine, nil },
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go a.Run(ctx)
	require.Eventually(t, func() bool { a.mu.Lock(); defer a.mu.Unlock(); return a.ctx != nil }, time.Second, 10*time.Millisecond)
	rec, _, _ := call(t, a.Handler(), http.MethodPost, "/v1/up", ipc.UpRequest{Token: "good", Server: server})
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())

	// The peer and the network's domain arrive with the first sync (enrollment
	// here sends no domain).
	require.Eventually(t, func() bool {
		return len(engine.lookup(t, "server.brave-otter.mesh.jabed.dev.", dnsmessage.TypeA)) == 1
	}, 2*time.Second, 20*time.Millisecond)
	answers := engine.lookup(t, "server.brave-otter.mesh.jabed.dev.", dnsmessage.TypeAAAA)
	require.Len(t, answers, 1)
	assert.Equal(t, netip.MustParseAddr("fd00:1:2::3").As16(), answers[0].Body.(*dnsmessage.AAAAResource).AAAA)
	answers = engine.lookup(t, "laptop.brave-otter.mesh.jabed.dev.", dnsmessage.TypeA)
	require.Len(t, answers, 1)
	assert.Equal(t, [4]byte{10, 77, 0, 2}, answers[0].Body.(*dnsmessage.AResource).A)
	// The network's reverse zone comes from the state file.
	answers = engine.lookup(t, "3.0.77.10.in-addr.arpa.", dnsmessage.TypePTR)
	require.Len(t, answers, 1)
	assert.Equal(t, "server.brave-otter.mesh.jabed.dev.", answers[0].Body.(*dnsmessage.PTRResource).PTR.String())

	_, status, _ := call(t, a.Handler(), http.MethodGet, "/v1/status", nil)
	require.NotNil(t, status.DNS)
	assert.Equal(t, "laptop.brave-otter.mesh.jabed.dev", status.DNS.Name)
	assert.Equal(t, "brave-otter.mesh.jabed.dev", status.DNS.Domain)
	assert.Equal(t, "10.77.0.53", status.DNS.Resolver)
	assert.Empty(t, status.DNS.Configured, "tests leave the OS resolver alone")
	assert.Equal(t, "server.brave-otter.mesh.jabed.dev", status.Peers[0].DNSName)
}

func TestRenameFromControlPlaneIsSaved(t *testing.T) {
	server, _ := signedControlPlane(t)
	a := &Agent{
		Version:      "test",
		StateDir:     t.TempDir(),
		SyncInterval: 50 * time.Millisecond,
		StartEngine:  func(wireguard.Config) (Engine, error) { return &fakeEngine{}, nil },
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go a.Run(ctx)
	require.Eventually(t, func() bool { a.mu.Lock(); defer a.mu.Unlock(); return a.ctx != nil }, time.Second, 10*time.Millisecond)
	rec, _, _ := call(t, a.Handler(), http.MethodPost, "/v1/up", ipc.UpRequest{Token: "good", Server: server})
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())

	// Renamed from the web: the next sync carries the new name.
	selfName.Store("workstation")
	require.Eventually(t, func() bool {
		_, status, _ := call(t, a.Handler(), http.MethodGet, "/v1/status", nil)
		return status.Device.Name == "workstation" && status.DNS != nil && status.DNS.Name == "workstation.brave-otter.mesh.jabed.dev"
	}, 2*time.Second, 20*time.Millisecond)

	// Saved with the network's domain, so they survive a restart before the next sync.
	st, err := stateLoad(a)
	require.NoError(t, err)
	assert.Equal(t, "workstation", st.Device.Name)
	assert.Equal(t, "brave-otter.mesh.jabed.dev", st.Network.DNSDomain)
}

func TestWatchSyncsAsSoonAsTheMapChanges(t *testing.T) {
	server, syncs := signedControlPlane(t)
	watchable.Store(true)
	engine := &fakeEngine{}
	a := &Agent{
		Version:  "test",
		StateDir: t.TempDir(),
		// Only the watch can bring the rename in time.
		SyncInterval:      time.Hour,
		WatchSyncInterval: time.Hour,
		WatchRetry:        20 * time.Millisecond,
		StartEngine:       func(wireguard.Config) (Engine, error) { return engine, nil },
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go a.Run(ctx)
	require.Eventually(t, func() bool { a.mu.Lock(); defer a.mu.Unlock(); return a.ctx != nil }, time.Second, 10*time.Millisecond)
	rec, _, _ := call(t, a.Handler(), http.MethodPost, "/v1/up", ipc.UpRequest{Token: "good", Server: server})
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())

	require.Eventually(t, func() bool {
		_, status, _ := call(t, a.Handler(), http.MethodGet, "/v1/status", nil)
		return status.Watching
	}, 2*time.Second, 20*time.Millisecond)
	before := syncs.Load()

	selfName.Store("workstation")
	require.Eventually(t, func() bool {
		_, status, _ := call(t, a.Handler(), http.MethodGet, "/v1/status", nil)
		return status.Device.Name == "workstation"
	}, 2*time.Second, 20*time.Millisecond)
	assert.Equal(t, before+1, syncs.Load(), "one sync for the change")

	// Unchanged maps don't sync again; watches go on.
	seen := watches.Load()
	require.Eventually(t, func() bool { return watches.Load() > seen+2 }, 2*time.Second, 20*time.Millisecond)
	assert.Equal(t, before+1, syncs.Load())
}

func TestWithoutWireGuardStillSyncsAndExplains(t *testing.T) {
	server, syncs := signedControlPlane(t)
	a := &Agent{
		Version:      "test",
		StateDir:     t.TempDir(),
		SyncInterval: 50 * time.Millisecond,
		StartEngine: func(wireguard.Config) (Engine, error) {
			return nil, assert.AnError
		},
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go a.Run(ctx)
	require.Eventually(t, func() bool { a.mu.Lock(); defer a.mu.Unlock(); return a.ctx != nil }, time.Second, 10*time.Millisecond)

	rec, _, _ := call(t, a.Handler(), http.MethodPost, "/v1/up", ipc.UpRequest{Token: "good", Server: server})
	require.Equal(t, http.StatusOK, rec.Code)
	require.Eventually(t, func() bool { return syncs.Load() > 0 }, 2*time.Second, 20*time.Millisecond)

	_, status, _ := call(t, a.Handler(), http.MethodGet, "/v1/status", nil)
	assert.Equal(t, "enrolled", status.State)
	assert.Contains(t, status.Problem, "WireGuard is not running")
	require.Len(t, status.Peers, 1, "peers are still listed")
}

// Regression: a failed start that returns a typed nil (*wireguard.Engine)(nil)
// inside the Engine interface used to crash the sync loop.
func TestTypedNilEngineDoesNotCrash(t *testing.T) {
	server, syncs := signedControlPlane(t)
	a := &Agent{
		Version:      "test",
		StateDir:     t.TempDir(),
		SyncInterval: 50 * time.Millisecond,
		StartEngine: func(wireguard.Config) (Engine, error) {
			var e *wireguard.Engine
			return e, assert.AnError
		},
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go a.Run(ctx)
	require.Eventually(t, func() bool { a.mu.Lock(); defer a.mu.Unlock(); return a.ctx != nil }, time.Second, 10*time.Millisecond)

	rec, _, _ := call(t, a.Handler(), http.MethodPost, "/v1/up", ipc.UpRequest{Token: "good", Server: server})
	require.Equal(t, http.StatusOK, rec.Code)
	require.Eventually(t, func() bool { return syncs.Load() >= 2 }, 2*time.Second, 20*time.Millisecond)

	_, status, _ := call(t, a.Handler(), http.MethodGet, "/v1/status", nil)
	assert.Equal(t, "enrolled", status.State)
	assert.Contains(t, status.Problem, "WireGuard is not running")
}

func (e *fakeEngine) SetInterceptor(wireguard.Interceptor) {}
func (e *fakeEngine) SendTo(netip.AddrPort, []byte) error  { return nil }
func (e *fakeEngine) Rebind() error                        { e.rebinds.Add(1); return nil }
func (e *fakeEngine) SetACL(p acl.Policy) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.acl = &p
}
func (e *fakeEngine) ACLDropped() uint64 { return 0 }
func (e *fakeEngine) SetLocalHandler(h wireguard.LocalHandler) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.local = h
}

// lookup sends a DNS query the way the OS would, as a packet into the TUN
// for the resolver address, and returns the answers.
func (e *fakeEngine) lookup(t *testing.T, name string, qtype dnsmessage.Type) []dnsmessage.Resource {
	t.Helper()
	q, err := (&dnsmessage.Message{
		Header:    dnsmessage.Header{ID: 7, RecursionDesired: true},
		Questions: []dnsmessage.Question{{Name: dnsmessage.MustNewName(name), Type: qtype, Class: dnsmessage.ClassINET}},
	}).Pack()
	require.NoError(t, err)
	packet := make([]byte, 28+len(q))
	packet[0], packet[9] = 0x45, 17 // IPv4, UDP
	binary.BigEndian.PutUint16(packet[2:], uint16(len(packet)))
	copy(packet[12:], []byte{10, 77, 0, 2})
	copy(packet[16:], []byte{10, 77, 0, 53}) // the resolver in 10.77.0.0/16
	binary.BigEndian.PutUint16(packet[20:], 40000)
	binary.BigEndian.PutUint16(packet[22:], 53)
	binary.BigEndian.PutUint16(packet[24:], uint16(8+len(q)))
	copy(packet[28:], q)

	e.mu.Lock()
	local := e.local
	e.mu.Unlock()
	require.NotNil(t, local, "no DNS handler on the engine")
	reply, handled := local(packet)
	require.True(t, handled)
	require.Greater(t, len(reply), 28)
	var m dnsmessage.Message
	require.NoError(t, m.Unpack(reply[28:]))
	return m.Answers
}
func (e *fakeEngine) ACL() *acl.Policy {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.acl
}

func runningAgent(t *testing.T, server string) (*Agent, http.Handler) {
	t.Helper()
	a := &Agent{
		Version:      "test",
		StateDir:     t.TempDir(),
		SyncInterval: 50 * time.Millisecond,
		StartEngine:  func(wireguard.Config) (Engine, error) { return &fakeEngine{}, nil },
	}
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	go a.Run(ctx)
	require.Eventually(t, func() bool { a.mu.Lock(); defer a.mu.Unlock(); return a.ctx != nil }, time.Second, 10*time.Millisecond)
	rec, _, _ := call(t, a.Handler(), http.MethodPost, "/v1/up", ipc.UpRequest{Token: "good", Server: server})
	require.Equal(t, http.StatusOK, rec.Code)
	return a, a.Handler()
}

func status(t *testing.T, h http.Handler) ipc.Status {
	t.Helper()
	_, s, _ := call(t, h, http.MethodGet, "/v1/status", nil)
	return s
}

func TestDownThenUpReconnects(t *testing.T) {
	server, syncs := signedControlPlane(t)
	a, h := runningAgent(t, server)
	require.Eventually(t, func() bool { return status(t, h).State == "connected" }, 2*time.Second, 20*time.Millisecond)

	rec, s, _ := call(t, h, http.MethodPost, "/v1/down", nil)
	require.Equal(t, http.StatusOK, rec.Code)
	assert.Equal(t, "down", s.State)
	assert.Empty(t, s.Peers)

	// No syncs while down.
	before := syncs.Load()
	time.Sleep(200 * time.Millisecond)
	assert.Equal(t, before, syncs.Load(), "a down device doesn't sync")

	// Down survives a restart.
	st, err := stateLoad(a)
	require.NoError(t, err)
	assert.True(t, st.Disabled)

	rec, _, _ = call(t, h, http.MethodPost, "/v1/up", ipc.UpRequest{})
	require.Equal(t, http.StatusOK, rec.Code)
	require.Eventually(t, func() bool { return status(t, h).State == "connected" }, 2*time.Second, 20*time.Millisecond)
	assert.Greater(t, syncs.Load(), before)
}

func TestLogoutRemovesDeviceAndState(t *testing.T) {
	server, _ := signedControlPlane(t)
	a, h := runningAgent(t, server)
	require.Eventually(t, func() bool { return status(t, h).State == "connected" }, 2*time.Second, 20*time.Millisecond)

	rec, s, _ := call(t, h, http.MethodPost, "/v1/logout", ipc.LogoutRequest{})
	require.Equal(t, http.StatusOK, rec.Code)
	assert.Equal(t, "not_enrolled", s.State)
	assert.Equal(t, int32(1), deletes.Load(), "server was told")
	_, err := stateLoad(a)
	assert.Error(t, err, "local state is gone")
}

func TestLogoutNeedsForceWhenServerUnreachable(t *testing.T) {
	server, _ := signedControlPlane(t)
	a, h := runningAgent(t, server)

	// Point the saved state at a dead server.
	st, err := stateLoad(a)
	require.NoError(t, err)
	st.ServerURL = "http://127.0.0.1:1"
	require.NoError(t, stateSave(a, st))

	rec, _, apiErr := call(t, h, http.MethodPost, "/v1/logout", ipc.LogoutRequest{})
	assert.Equal(t, http.StatusBadGateway, rec.Code)
	assert.Contains(t, apiErr.Message, "--force")
	_, err = stateLoad(a)
	assert.NoError(t, err, "still enrolled")

	rec, _, _ = call(t, h, http.MethodPost, "/v1/logout", ipc.LogoutRequest{Force: true})
	assert.Equal(t, http.StatusOK, rec.Code)
	_, err = stateLoad(a)
	assert.Error(t, err)
}

func TestClassifyNAT(t *testing.T) {
	a := netip.MustParseAddrPort("203.0.113.5:51820")
	b := netip.MustParseAddrPort("203.0.113.5:40000")
	assert.Equal(t, "unknown", classifyNAT([]netip.AddrPort{a}))
	assert.Equal(t, "endpoint-independent", classifyNAT([]netip.AddrPort{a, a}))
	assert.Equal(t, "symmetric", classifyNAT([]netip.AddrPort{a, b}))
}

func TestSyncProblem(t *testing.T) {
	removed := &coordination.Error{Status: http.StatusUnauthorized, Code: "invalid_device_signature"}
	assert.Contains(t, syncProblem(removed), "removed from the network")
	assert.Contains(t, syncProblem(removed), "meshguard logout --force")
	assert.Equal(t, "cannot reach the control plane: boom", syncProblem(errors.New("boom")))
}
