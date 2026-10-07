package agent

import (
	"net/netip"
	"testing"

	"github.com/jabedzaman/meshguard/internal/coordination"
	"github.com/stretchr/testify/assert"
)

func pfx(ss ...string) []netip.Prefix {
	var out []netip.Prefix
	for _, s := range ss {
		out = append(out, netip.MustParsePrefix(s))
	}
	return out
}

func TestPlanRoutes(t *testing.T) {
	nm := &coordination.NetworkMap{
		Self: coordination.Self{Routes: []string{"172.20.0.0/16"}},
		Peers: []coordination.Peer{
			{ID: "a", Routes: []string{"192.168.50.0/24", "10.9.0.0/16"}},
			{ID: "b", Routes: []string{"192.168.50.0/24", "10.77.5.0/24", "172.16.0.0/12", "bogus"}},
			{ID: "c"},
		},
	}
	mesh := pfx("10.77.0.0/16")
	local := pfx("172.16.3.0/24")

	t.Run("without accept-routes only what we serve", func(t *testing.T) {
		plan := planRoutes(nm, false, mesh, local)
		assert.Equal(t, pfx("172.20.0.0/16"), plan.serve)
		assert.Empty(t, plan.accepted)
		assert.Empty(t, plan.byPeer)
	})

	t.Run("accepting: first peer wins, mesh and local networks are skipped", func(t *testing.T) {
		plan := planRoutes(nm, true, mesh, local)
		assert.Equal(t, pfx("192.168.50.0/24", "10.9.0.0/16"), plan.accepted)
		assert.Equal(t, pfx("192.168.50.0/24", "10.9.0.0/16"), plan.byPeer["a"])
		assert.Empty(t, plan.byPeer["b"], "b's routes are duplicates, mesh, on a local network or invalid")
	})
}
