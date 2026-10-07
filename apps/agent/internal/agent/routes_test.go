package agent

import (
	"net/netip"
	"testing"

	"github.com/jabedzaman/meshguard/internal/coordination"
	"github.com/jabedzaman/meshguard/internal/state"
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
		plan := planRoutes(nm, false, "", mesh, local)
		assert.Equal(t, pfx("172.20.0.0/16"), plan.serve)
		assert.Empty(t, plan.accepted)
		assert.Empty(t, plan.byPeer)
	})

	t.Run("accepting: first peer wins, mesh and local networks are skipped", func(t *testing.T) {
		plan := planRoutes(nm, true, "", mesh, local)
		assert.Equal(t, pfx("192.168.50.0/24", "10.9.0.0/16"), plan.accepted)
		assert.Equal(t, pfx("192.168.50.0/24", "10.9.0.0/16"), plan.byPeer["a"])
		assert.Empty(t, plan.byPeer["b"], "b's routes are duplicates, mesh, on a local network or invalid")
	})
}

func TestPlanServices(t *testing.T) {
	host := "peer-a"
	nm := &coordination.NetworkMap{
		Peers: []coordination.Peer{{ID: "peer-a", Name: "a"}, {ID: "peer-b", Name: "b"}},
		Services: []coordination.Service{
			{Name: "web", VIP: "10.77.9.1", HostID: &host},
			{Name: "db", VIP: "10.77.9.2", Hosting: true},
			{Name: "idle", VIP: "10.77.9.3"},
			{Name: "bad", VIP: "nonsense", HostID: &host},
		},
	}
	plan := planRoutes(nm, false, "", pfx("10.77.0.0/16"), nil)
	assert.Equal(t, pfx("10.77.9.1/32"), plan.byPeer["peer-a"], "the address goes to its host")
	assert.Empty(t, plan.byPeer["peer-b"])
	assert.Equal(t, []netip.Addr{netip.MustParseAddr("10.77.9.2")}, plan.hosted)
}

func TestDNSRecordsForServices(t *testing.T) {
	records := dnsRecords(state.Device{Name: "me", MeshIPv4: "10.77.0.1"}, nil,
		[]coordination.Service{{Name: "web", VIP: "10.77.9.1"}})
	assert.Equal(t, "10.77.9.1", records["web.svc"].IPv4.String())
	assert.Equal(t, "10.77.0.1", records["me"].IPv4.String())
}

func TestPlanExitNode(t *testing.T) {
	nm := &coordination.NetworkMap{
		Peers: []coordination.Peer{
			{ID: "a", Name: "gateway", MeshIPv4: "10.77.0.2", Routes: []string{"0.0.0.0/0", "::/0", "192.168.1.0/24"}},
			{ID: "b", Name: "plain", MeshIPv4: "10.77.0.3"},
		},
	}
	mesh := pfx("10.77.0.0/16")

	plan := planRoutes(nm, true, "Gateway", mesh, nil)
	assert.Equal(t, "gateway", plan.exitPeer)
	assert.Empty(t, plan.exitProblem)
	assert.Equal(t, pfx("0.0.0.0/0", "::/0", "192.168.1.0/24"), plan.byPeer["a"], "default routes go to the exit node's allowed IPs")
	assert.Equal(t, pfx("192.168.1.0/24"), plan.accepted, "a default route is never an accepted subnet")

	assert.Equal(t, "gateway", planRoutes(nm, false, "10.77.0.2", mesh, nil).exitPeer, "by mesh address, without accept-routes")

	plan = planRoutes(nm, false, "plain", mesh, nil)
	assert.Empty(t, plan.exitPeer)
	assert.Contains(t, plan.exitProblem, "approved")

	plan = planRoutes(nm, false, "nobody", mesh, nil)
	assert.Contains(t, plan.exitProblem, "isn't a device")
}
