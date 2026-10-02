package agent

import (
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/twinlabshq/mesh/internal/coordination"
	"github.com/twinlabshq/mesh/internal/ipc"
	"github.com/twinlabshq/mesh/internal/wireguard"
)

type fakeEngine struct {
	mu    sync.Mutex
	peers []wireguard.Peer
	cfg   wireguard.Config
}

func (e *fakeEngine) Name() string { return "mesh-test0" }
func (e *fakeEngine) Close()       {}
func (e *fakeEngine) SetPeers(p []wireguard.Peer) (bool, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.peers = p
	return true, nil
}
func (e *fakeEngine) Stats() (map[string]wireguard.PeerStats, error) { return nil, nil }
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
func signedControlPlane(t *testing.T) (url string, syncs *atomic.Int32) {
	t.Helper()
	var mu sync.Mutex
	var identityKey ed25519.PublicKey
	var count atomic.Int32
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
		case "/v1/devices/self/sync":
			sig, _ := base64.StdEncoding.DecodeString(r.Header.Get(coordination.HeaderSignature))
			msg := coordination.SigningString(r.Method, r.URL.Path, r.Header.Get(coordination.HeaderTimestamp), body)
			if r.Header.Get(coordination.HeaderDevice) != "d1" || !ed25519.Verify(identityKey, []byte(msg), sig) {
				w.WriteHeader(http.StatusUnauthorized)
				_, _ = w.Write([]byte(`{"error":{"code":"invalid_device_signature","message":"Invalid device signature"}}`))
				return
			}
			count.Add(1)
			_, _ = w.Write([]byte(`{"self":{"id":"d1","name":"laptop","meshIpv4":"10.77.0.2"},"network":{"id":"n1","name":"home"},"peers":[{"id":"d2","name":"server","wireguardPublicKey":"` + peerKey + `","meshIpv4":"10.77.0.3","meshIpv6":"fd00:1:2:0::3","endpoints":["192.168.1.9:51820","[2001:db8::9]:51820"]}]}`))
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

	// Peer: first endpoint, host routes for both mesh addresses.
	peer := engine.Peers()[0]
	assert.Equal(t, "192.168.1.9:51820", peer.Endpoint)
	require.Len(t, peer.AllowedIPs, 2)
	assert.Equal(t, "10.77.0.3/32", peer.AllowedIPs[0].String())
	assert.Equal(t, "fd00:1:2::3/128", peer.AllowedIPs[1].String())

	_, status, _ := call(t, a.Handler(), http.MethodGet, "/v1/status", nil)
	assert.Equal(t, "connected", status.State)
	assert.Empty(t, status.Problem)
	assert.Equal(t, "mesh-test0", status.Interface)
	require.Len(t, status.Peers, 1)
	assert.Equal(t, "server", status.Peers[0].Name)
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
