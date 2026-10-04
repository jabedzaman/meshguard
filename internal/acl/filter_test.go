package acl

import (
	"encoding/binary"
	"net/netip"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

var (
	self  = netip.MustParseAddr("10.77.0.1")
	peer  = netip.MustParseAddr("10.77.0.2")
	other = netip.MustParseAddr("10.77.0.3")
	self6 = netip.MustParseAddr("fd00::1")
	peer6 = netip.MustParseAddr("fd00::2")
)

func ports(src, dst uint16) []byte {
	b := make([]byte, 20)
	binary.BigEndian.PutUint16(b[0:2], src)
	binary.BigEndian.PutUint16(b[2:4], dst)
	return b
}

func echo(typ uint8, id uint16) []byte {
	b := make([]byte, 8)
	b[0] = typ
	binary.BigEndian.PutUint16(b[4:6], id)
	return b
}

func ip4(proto uint8, src, dst netip.Addr, l4 []byte) []byte {
	b := make([]byte, 20, 20+len(l4))
	b[0] = 0x45
	b[9] = proto
	s, d := src.As4(), dst.As4()
	copy(b[12:16], s[:])
	copy(b[16:20], d[:])
	return append(b, l4...)
}

func ip6(next uint8, src, dst netip.Addr, rest []byte) []byte {
	b := make([]byte, 40, 40+len(rest))
	b[0] = 0x60
	b[6] = next
	s, d := src.As16(), dst.As16()
	copy(b[8:24], s[:])
	copy(b[24:40], d[:])
	return append(b, rest...)
}

func tcp(src, dst netip.Addr, sport, dport uint16) []byte {
	return ip4(protoTCP, src, dst, ports(sport, dport))
}

func host(a netip.Addr) netip.Prefix { return netip.PrefixFrom(a, a.BitLen()) }

func TestAllowAllLetsEverythingIn(t *testing.T) {
	f := NewFilter(AllowAllPolicy)
	assert.True(t, f.Allow(tcp(peer, self, 40000, 22)))
	assert.True(t, f.Allow([]byte{0xff}))
	assert.Zero(t, f.Dropped())
}

func TestDenyByDefault(t *testing.T) {
	f := NewFilter(Policy{})
	assert.False(t, f.Allow(tcp(peer, self, 40000, 22)))
	assert.False(t, f.Allow(ip4(protoICMP, peer, self, echo(8, 1))))
	assert.False(t, f.Allow([]byte{0x45, 0, 0}), "malformed")
	assert.EqualValues(t, 3, f.Dropped())
}

func TestRulesMatchSourceProtocolAndPort(t *testing.T) {
	f := NewFilter(Policy{Rules: []Rule{
		{Sources: []netip.Prefix{host(peer), host(peer6)}, Protocol: TCP, PortFirst: 22, PortLast: 22},
		{Protocol: UDP, PortFirst: 8000, PortLast: 8100},
		{Sources: []netip.Prefix{host(other)}, Protocol: ICMP},
	}})

	assert.True(t, f.Allow(tcp(peer, self, 40000, 22)))
	assert.True(t, f.Allow(ip6(protoTCP, peer6, self6, ports(40000, 22))))
	assert.False(t, f.Allow(tcp(other, self, 40000, 22)), "wrong source")
	assert.False(t, f.Allow(tcp(peer, self, 40000, 23)), "wrong port")
	assert.False(t, f.Allow(ip4(protoUDP, peer, self, ports(40000, 22))), "wrong protocol")

	assert.True(t, f.Allow(ip4(protoUDP, other, self, ports(1, 8000))), "any source")
	assert.True(t, f.Allow(ip4(protoUDP, peer, self, ports(1, 8100))))
	assert.False(t, f.Allow(ip4(protoUDP, peer, self, ports(1, 8101))))

	assert.True(t, f.Allow(ip4(protoICMP, other, self, echo(8, 7))))
	assert.False(t, f.Allow(ip4(protoICMP, peer, self, echo(8, 7))))
}

func TestAnyProtocolAllowsEverythingFromTheSource(t *testing.T) {
	f := NewFilter(Policy{Rules: []Rule{{Sources: []netip.Prefix{host(peer)}, Protocol: Any}}})
	assert.True(t, f.Allow(tcp(peer, self, 1, 2)))
	assert.True(t, f.Allow(ip4(protoUDP, peer, self, ports(1, 2))))
	assert.True(t, f.Allow(ip4(protoICMP, peer, self, echo(8, 1))))
	assert.False(t, f.Allow(tcp(other, self, 1, 2)))
}

func TestRepliesToOutboundConnectionsPass(t *testing.T) {
	f := NewFilter(Policy{})
	f.Outbound(tcp(self, peer, 40000, 443))
	assert.True(t, f.Allow(tcp(peer, self, 443, 40000)), "reply")
	assert.False(t, f.Allow(tcp(peer, self, 443, 40001)), "other local port")
	assert.False(t, f.Allow(tcp(other, self, 443, 40000)), "other peer")
	assert.False(t, f.Allow(tcp(peer, self, 40000, 443)), "not a reply")

	f.Outbound(ip4(protoICMP, self, peer, echo(8, 99)))
	assert.True(t, f.Allow(ip4(protoICMP, peer, self, echo(0, 99))), "echo reply")
	assert.False(t, f.Allow(ip4(protoICMP, peer, self, echo(0, 98))))
	assert.False(t, f.Allow(ip4(protoICMP, peer, self, echo(8, 99))), "echo request isn't a reply")

	f.Outbound(ip6(protoICMPv6, self6, peer6, echo(128, 5)))
	assert.True(t, f.Allow(ip6(protoICMPv6, peer6, self6, echo(129, 5))))
}

func TestTrackedFlowsExpire(t *testing.T) {
	now := time.Unix(1000, 0)
	f := NewFilter(Policy{})
	f.now = func() time.Time { return now }
	f.Outbound(ip4(protoUDP, self, peer, ports(5000, 53)))
	reply := ip4(protoUDP, peer, self, ports(53, 5000))
	require.True(t, f.Allow(reply))

	now = now.Add(flowTimeout + time.Second)
	assert.False(t, f.Allow(reply))
	f.Outbound(ip4(protoUDP, self, other, ports(5001, 53))) // sweeps
	f.mu.Lock()
	assert.Len(t, f.flows, 1)
	f.mu.Unlock()
}

func TestFlowsSurvivePolicyChanges(t *testing.T) {
	f := NewFilter(AllowAllPolicy)
	f.Outbound(tcp(self, peer, 40000, 22))
	f.SetPolicy(Policy{})
	assert.True(t, f.Allow(tcp(peer, self, 22, 40000)))
}

func TestICMPErrorsAndFragmentsPass(t *testing.T) {
	f := NewFilter(Policy{})
	assert.True(t, f.Allow(ip4(protoICMP, peer, self, echo(3, 0))), "unreachable")
	assert.True(t, f.Allow(ip6(protoICMPv6, peer6, self6, echo(2, 0))), "packet too big")

	frag := tcp(peer, self, 40000, 22)
	binary.BigEndian.PutUint16(frag[6:8], 100) // fragment offset 100
	assert.True(t, f.Allow(frag))
}

func TestIPv6ExtensionHeaders(t *testing.T) {
	f := NewFilter(Policy{Rules: []Rule{{Protocol: TCP, PortFirst: 22, PortLast: 22}}})
	hopByHop := append([]byte{protoTCP, 0, 0, 0, 0, 0, 0, 0}, ports(40000, 22)...)
	assert.True(t, f.Allow(ip6(0, peer6, self6, hopByHop)))

	firstFragment := append([]byte{protoTCP, 0, 0, 0, 0, 0, 0, 1}, ports(40000, 23)...)
	assert.False(t, f.Allow(ip6(44, peer6, self6, firstFragment)), "first fragment is checked")
}

func TestPolicyAllows(t *testing.T) {
	assert.True(t, AllowAllPolicy.Allows(peer, TCP, 22))

	p := Policy{Rules: []Rule{
		{Sources: []netip.Prefix{netip.PrefixFrom(peer, 32)}, Protocol: TCP, PortFirst: 8000, PortLast: 8080},
		{Protocol: ICMP},
	}}
	assert.True(t, p.Allows(peer, TCP, 8080))
	assert.False(t, p.Allows(peer, TCP, 22), "port outside the rule")
	assert.False(t, p.Allows(other, TCP, 8080), "source outside the rule")
	assert.False(t, p.Allows(peer, UDP, 8080), "other protocol")
	assert.True(t, p.Allows(other, ICMP, 0))
	assert.True(t, p.Allows(peer6, ICMP, 0), "ICMPv6 counts as ICMP")
	assert.False(t, Policy{Rules: []Rule{}}.Allows(peer, ICMP, 0), "deny without rules")
}
