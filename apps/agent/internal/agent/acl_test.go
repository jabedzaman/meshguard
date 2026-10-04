package agent

import (
	"encoding/json"
	"net/http"
	"net/netip"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/jabedzaman/meshguard/internal/acl"
	"github.com/jabedzaman/meshguard/internal/coordination"
	"github.com/jabedzaman/meshguard/internal/ipc"
)

func parseACL(t *testing.T, raw string) *coordination.ACL {
	t.Helper()
	var a coordination.ACL
	require.NoError(t, json.Unmarshal([]byte(raw), &a))
	return &a
}

func TestACLPolicyAllowsAllWithoutRules(t *testing.T) {
	assert.Equal(t, acl.AllowAllPolicy, aclPolicy(nil), "older control plane")
	assert.Equal(t, acl.AllowAllPolicy, aclPolicy(parseACL(t, `{"defaultAction":"allow","inbound":[]}`)))
}

func TestACLPolicyConvertsRules(t *testing.T) {
	policy := aclPolicy(parseACL(t, `{"defaultAction":"deny","inbound":[
		{"sources":["10.77.0.2","fd00::2"],"protocol":"tcp","portFrom":22,"portTo":null},
		{"sources":null,"protocol":"udp","portFrom":8000,"portTo":8100},
		{"sources":null,"protocol":"icmp","portFrom":null,"portTo":null}
	]}`))
	assert.False(t, policy.AllowAll)
	assert.Equal(t, []acl.Rule{
		{
			Sources:  []netip.Prefix{netip.MustParsePrefix("10.77.0.2/32"), netip.MustParsePrefix("fd00::2/128")},
			Protocol: acl.TCP, PortFirst: 22, PortLast: 22,
		},
		{Protocol: acl.UDP, PortFirst: 8000, PortLast: 8100},
		{Protocol: acl.ICMP},
	}, policy.Rules)
}

func TestACLPolicySkipsRulesItCannotEnforce(t *testing.T) {
	policy := aclPolicy(parseACL(t, `{"defaultAction":"deny","inbound":[
		{"sources":[],"protocol":"any"},
		{"sources":["not-an-ip"],"protocol":"any"},
		{"sources":null,"protocol":"sctp"},
		{"sources":null,"protocol":"tcp","portFrom":90,"portTo":80}
	]}`))
	assert.False(t, policy.AllowAll)
	assert.Empty(t, policy.Rules, "skipping denies; it never widens to any source")
}

func TestUnknownDefaultActionDenies(t *testing.T) {
	assert.False(t, aclPolicy(parseACL(t, `{"defaultAction":"maybe"}`)).AllowAll)
}

func TestAccessEvaluatesRulesPerPeer(t *testing.T) {
	a := &Agent{StateDir: t.TempDir()}
	a.conn = &connection{
		lastSync: time.Now(),
		peers: []coordination.Peer{
			{Name: "laptop", MeshIPv4: "10.77.0.2"},
			{Name: "server", MeshIPv4: "10.77.0.3"},
		},
		acl: parseACL(t, `{"defaultAction":"deny","inbound":[
			{"sources":["10.77.0.2"],"protocol":"tcp","portFrom":22}
		]}`),
	}
	access := func(query string) (int, ipc.Access) {
		rec := callRaw(t, a.Handler(), "/v1/access?"+query)
		var res ipc.Access
		if rec.Code == http.StatusOK {
			require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &res))
		}
		return rec.Code, res
	}

	code, res := access("protocol=tcp&port=22")
	require.Equal(t, http.StatusOK, code)
	assert.True(t, res.Synced)
	assert.Equal(t, "deny", res.DefaultAction)
	assert.Equal(t, []ipc.PeerAccess{
		{Name: "laptop", MeshIPv4: "10.77.0.2", Allowed: true},
		{Name: "server", MeshIPv4: "10.77.0.3", Allowed: false},
	}, res.Peers)

	_, res = access("protocol=icmp")
	assert.False(t, res.Peers[0].Allowed)

	code, _ = access("protocol=tcp")
	assert.Equal(t, http.StatusBadRequest, code, "tcp needs a port")
	code, _ = access("protocol=sctp&port=1")
	assert.Equal(t, http.StatusBadRequest, code)

	a.conn.lastSync = time.Time{}
	_, res = access("protocol=tcp&port=22")
	assert.False(t, res.Synced)
	assert.False(t, res.Peers[0].Allowed, "nothing gets in before the first sync")
}
