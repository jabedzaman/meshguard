package agent

import (
	"log/slog"
	"net/netip"
	"strings"
	"time"

	"github.com/twinlabshq/mesh/internal/discovery"
	"github.com/twinlabshq/mesh/internal/state"
)

const (
	// sleepGap is how far past its interval a check may run before we
	// assume the machine slept (or the process was frozen).
	sleepGap = 10 * time.Second
	// stunSettle is how long to wait for STUN answers after a network
	// change before syncing, so the new public address is advertised.
	stunSettle = time.Second
)

// watchNetwork polls for network changes (addresses appearing or going away:
// a new Wi-Fi, a cable, a VPN) and for wake from sleep, and rebinds when
// either happens. Polling is portable and cheap at this interval.
func (a *Agent) watchNetwork(c *connection, st *state.State) {
	every := a.NetCheckInterval
	if every == 0 {
		every = 2 * time.Second
	}
	linkState := a.linkState
	if linkState == nil {
		linkState = localAddresses
	}
	exclude := meshPrefixes(st)

	a.mu.Lock()
	engine := c.engine
	a.mu.Unlock()
	last, prev := time.Now(), linkState(engine, exclude)

	ticker := time.NewTicker(every)
	defer ticker.Stop()
	for {
		select {
		case <-c.ctx.Done():
			return
		case <-ticker.C:
		}
		now, cur := time.Now(), linkState(engine, exclude)
		switch {
		case slept(last, now, every):
			a.rebind(c, "wake")
		case cur != prev:
			a.rebind(c, "network change")
		}
		last, prev = now, cur
	}
}

// slept reports whether a check that should have run every `every` ran much
// later. Both clocks are compared: Go's monotonic clock stops during sleep on
// Linux and macOS, while the wall clock keeps going.
func slept(last, now time.Time, every time.Duration) bool {
	gap := max(now.Sub(last), now.Round(0).Sub(last.Round(0)))
	return gap > every+sleepGap
}

func localAddresses(engine Engine, exclude []netip.Prefix) string {
	return strings.Join(discovery.Endpoints(0, engine.Name(), exclude), ",")
}

// rebind recovers after a network change or wake: old sockets, NAT mappings,
// hole-punched paths and the relay connection may all be dead without any
// error. Peers fall back to the relay until direct paths are found again.
func (a *Agent) rebind(c *connection, reason string) {
	a.mu.Lock()
	if !a.current(c) {
		a.mu.Unlock()
		return
	}
	engine, d, rc, servers := c.engine, c.disco, c.relayClient, c.stun
	a.mu.Unlock()
	slog.Info("rebinding", "reason", reason)

	if err := engine.Rebind(); err != nil {
		slog.Warn("rebind sockets", "err", err)
	}
	a.nat.reset()
	if d != nil {
		d.Reset()
	}
	if rc != nil {
		rc.Reconnect()
	}
	// Learn the new public address, then tell the control plane where we
	// are now so peers can find us.
	a.probeStun(engine, servers)
	time.AfterFunc(stunSettle, func() {
		select {
		case c.syncNow <- struct{}{}:
		default:
		}
	})
}
