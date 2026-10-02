package agent

import (
	"context"
	"net/http"
	"net/netip"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/twinlabshq/mesh/internal/ipc"
	"github.com/twinlabshq/mesh/internal/wireguard"
)

func TestNetworkChangeRebindsAndSyncs(t *testing.T) {
	server, syncs := signedControlPlane(t)
	engine := &fakeEngine{}
	var link atomic.Value
	link.Store("192.168.1.5")
	a := &Agent{
		Version:          "test",
		StateDir:         t.TempDir(),
		SyncInterval:     time.Hour, // only the first sync and rebinds
		NetCheckInterval: 20 * time.Millisecond,
		StartEngine:      func(wireguard.Config) (Engine, error) { return engine, nil },
		linkState:        func(Engine, []netip.Prefix) string { return link.Load().(string) },
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go a.Run(ctx)
	require.Eventually(t, func() bool { a.mu.Lock(); defer a.mu.Unlock(); return a.ctx != nil }, time.Second, 10*time.Millisecond)
	rec, _, _ := call(t, a.Handler(), http.MethodPost, "/v1/up", ipc.UpRequest{Token: "good", Server: server})
	require.Equal(t, http.StatusOK, rec.Code)
	require.Eventually(t, func() bool { return syncs.Load() == 1 }, 2*time.Second, 10*time.Millisecond)

	time.Sleep(100 * time.Millisecond)
	assert.Zero(t, engine.rebinds.Load(), "no change, no rebind")

	link.Store("10.0.0.7") // joined another network
	require.Eventually(t, func() bool { return engine.rebinds.Load() == 1 }, time.Second, 10*time.Millisecond)
	require.Eventually(t, func() bool { return syncs.Load() == 2 }, 3*time.Second, 20*time.Millisecond, "syncs right away instead of waiting the interval")
}

func TestSlept(t *testing.T) {
	every := 2 * time.Second
	last := time.Now()
	assert.False(t, slept(last, last.Add(every), every))
	assert.False(t, slept(last, last.Add(every+time.Second), every), "a slow tick is not sleep")
	assert.True(t, slept(last, last.Add(time.Minute), every), "monotonic gap")

	// Without monotonic readings (as across a sleep) the wall clock decides.
	assert.True(t, slept(last.Round(0), last.Round(0).Add(time.Hour), every), "wall clock gap")
}
