package agent

import (
	"net/netip"
	"testing"
	"time"

	"github.com/jabedzaman/meshguard/internal/coordination"
	"github.com/stretchr/testify/assert"
)

func addrs(ss ...string) []netip.Addr {
	var out []netip.Addr
	for _, s := range ss {
		out = append(out, netip.MustParseAddr(s))
	}
	return out
}

func TestDynamicRoutesAreLearnedRefreshedAndExpire(t *testing.T) {
	now := time.Unix(1000, 0)
	d := newDynamicRoutes()
	d.now = func() time.Time { return now }

	assert.True(t, d.learn("peer-a", addrs("93.184.216.34", "2001:db8::1"), 5*time.Minute), "new routes")
	assert.False(t, d.learn("peer-a", addrs("93.184.216.34"), 5*time.Minute), "known: just refreshed")
	assert.Equal(t, map[string][]netip.Prefix{
		"peer-a": pfx("2001:db8::1/128", "93.184.216.34/32"),
	}, d.byPeer())
	assert.Equal(t, 2, d.count("peer-a"))
	assert.Equal(t, 0, d.count("peer-b"))

	// The address moves to another host.
	assert.True(t, d.learn("peer-b", addrs("93.184.216.34"), 5*time.Minute))
	assert.Equal(t, pfx("93.184.216.34/32"), d.byPeer()["peer-b"])

	now = now.Add(4 * time.Minute)
	assert.False(t, d.prune(), "still good")
	d.learn("peer-b", addrs("93.184.216.34"), 5*time.Minute) // looked up again
	now = now.Add(2 * time.Minute)
	assert.True(t, d.prune(), "the IPv6 address ran out")
	assert.Equal(t, map[string][]netip.Prefix{"peer-b": pfx("93.184.216.34/32")}, d.byPeer())
	now = now.Add(10 * time.Minute)
	assert.True(t, d.prune())
	assert.Empty(t, d.byPeer())
}

func TestDynamicRoutesFollowTheHosts(t *testing.T) {
	d := newDynamicRoutes()
	d.learn("old-host", addrs("1.1.1.1"), time.Hour)
	d.learn("host", addrs("2.2.2.2"), time.Hour)
	assert.True(t, d.keepOnly(map[string]bool{"host": true}), "the old host's routes go")
	assert.Equal(t, map[string][]netip.Prefix{"host": pfx("2.2.2.2/32")}, d.byPeer())
	assert.False(t, d.keepOnly(map[string]bool{"host": true}))
}

func TestDynamicRoutesAreBounded(t *testing.T) {
	d := newDynamicRoutes()
	for i := 0; i < maxLearnedRoutes+50; i++ {
		d.learn("host", []netip.Addr{netip.AddrFrom4([4]byte{10, byte(i >> 16), byte(i >> 8), byte(i)})}, time.Hour)
	}
	assert.Equal(t, maxLearnedRoutes, d.count("host"))
}

func TestAConnectorHostForwardsAndGuards(t *testing.T) {
	host := &coordination.NetworkMap{Connectors: []coordination.Connector{{Name: "corp", Domains: []string{"corp.test"}, Hosting: true}}}
	plan := planRoutes(host, false, "", pfx("10.77.0.0/16"), nil)
	assert.True(t, plan.connecting)

	client := &coordination.NetworkMap{
		Peers:      []coordination.Peer{{ID: "h", Name: "gw"}},
		Connectors: []coordination.Connector{{Name: "corp", Domains: []string{"corp.test"}, HostID: strPtr("h")}},
	}
	plan = planRoutes(client, false, "", pfx("10.77.0.0/16"), nil)
	assert.False(t, plan.connecting, "a client forwards nothing")
}

func strPtr(s string) *string { return &s }
