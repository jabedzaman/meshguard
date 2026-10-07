package wireguard

import (
	"net/netip"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestMasqueradeRule(t *testing.T) {
	tool, args := masqueradeRule(netip.MustParsePrefix("192.168.50.0/24"), netip.MustParsePrefix("10.77.0.0/16"), "meshguard0")
	assert.Equal(t, "iptables", tool)
	assert.Equal(t, []string{"-t", "nat", "POSTROUTING", "-s", "10.77.0.0/16", "-d", "192.168.50.0/24", "-j", "MASQUERADE"}, args)

	tool, _ = masqueradeRule(netip.MustParsePrefix("2001:db8::/32"), netip.MustParsePrefix("fd00:1:2::/48"), "meshguard0")
	assert.Equal(t, "ip6tables", tool)
}

func TestMasqueradeRuleForAnExitNode(t *testing.T) {
	tool, args := masqueradeRule(netip.MustParsePrefix("0.0.0.0/0"), netip.MustParsePrefix("10.77.0.0/16"), "meshguard0")
	assert.Equal(t, "iptables", tool)
	assert.Equal(t, []string{"-t", "nat", "POSTROUTING", "-s", "10.77.0.0/16", "!", "-o", "meshguard0", "-j", "MASQUERADE"}, args)
}
