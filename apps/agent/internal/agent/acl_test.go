package agent

import (
	"encoding/json"
	"net/netip"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/jabedzaman/meshguard/internal/acl"
	"github.com/jabedzaman/meshguard/internal/coordination"
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
