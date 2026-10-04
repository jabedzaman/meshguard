package dns

import (
	"encoding/binary"
	"net/netip"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/net/dns/dnsmessage"
)

func testServer() *Server {
	s := &Server{}
	s.SetRecords(map[string]Record{
		"laptop": {IPv4: netip.MustParseAddr("10.77.0.9"), IPv6: netip.MustParseAddr("fd00:1:2::9")},
		"v4only": {IPv4: netip.MustParseAddr("10.77.0.10")},
	})
	return s
}

func query(t *testing.T, name string, qtype dnsmessage.Type) []byte {
	t.Helper()
	msg := dnsmessage.Message{
		Header:    dnsmessage.Header{ID: 42, RecursionDesired: true},
		Questions: []dnsmessage.Question{{Name: dnsmessage.MustNewName(name), Type: qtype, Class: dnsmessage.ClassINET}},
	}
	b, err := msg.Pack()
	require.NoError(t, err)
	return b
}

func ask(t *testing.T, s *Server, name string, qtype dnsmessage.Type) dnsmessage.Message {
	t.Helper()
	res, err := s.Answer(query(t, name, qtype))
	require.NoError(t, err)
	var m dnsmessage.Message
	require.NoError(t, m.Unpack(res))
	assert.Equal(t, uint16(42), m.ID)
	assert.True(t, m.Response)
	return m
}

func TestAnswersDevices(t *testing.T) {
	s := testServer()

	m := ask(t, s, "laptop.internal.", dnsmessage.TypeA)
	assert.Equal(t, dnsmessage.RCodeSuccess, m.RCode)
	assert.True(t, m.Authoritative)
	require.Len(t, m.Answers, 1)
	assert.Equal(t, [4]byte{10, 77, 0, 9}, m.Answers[0].Body.(*dnsmessage.AResource).A)
	assert.Equal(t, uint32(TTL), m.Answers[0].Header.TTL)

	m = ask(t, s, "LapTop.Internal.", dnsmessage.TypeAAAA)
	require.Len(t, m.Answers, 1)
	assert.Equal(t, netip.MustParseAddr("fd00:1:2::9").As16(), m.Answers[0].Body.(*dnsmessage.AAAAResource).AAAA)
}

func TestNoDataNXDomainAndRefused(t *testing.T) {
	s := testServer()

	m := ask(t, s, "v4only.internal.", dnsmessage.TypeAAAA)
	assert.Equal(t, dnsmessage.RCodeSuccess, m.RCode, "known name without IPv6 is NODATA")
	assert.Empty(t, m.Answers)

	m = ask(t, s, "laptop.internal.", dnsmessage.TypeMX)
	assert.Equal(t, dnsmessage.RCodeSuccess, m.RCode)
	assert.Empty(t, m.Answers)

	assert.Equal(t, dnsmessage.RCodeNameError, ask(t, s, "nope.internal.", dnsmessage.TypeA).RCode)
	assert.Equal(t, dnsmessage.RCodeNameError, ask(t, s, "x.laptop.internal.", dnsmessage.TypeA).RCode)
	assert.Equal(t, dnsmessage.RCodeSuccess, ask(t, s, "internal.", dnsmessage.TypeSOA).RCode)
	assert.Equal(t, dnsmessage.RCodeRefused, ask(t, s, "example.com.", dnsmessage.TypeA).RCode)
}

func TestSetRecordsReplaces(t *testing.T) {
	s := testServer()
	s.SetRecords(map[string]Record{"desktop": {IPv4: netip.MustParseAddr("10.77.0.11")}})
	assert.Equal(t, dnsmessage.RCodeNameError, ask(t, s, "laptop.internal.", dnsmessage.TypeA).RCode)
	assert.Len(t, ask(t, s, "desktop.internal.", dnsmessage.TypeA).Answers, 1)
}

func TestReverseLookups(t *testing.T) {
	s := testServer()
	s.SetNetworks([]netip.Prefix{netip.MustParsePrefix("10.77.0.0/16"), netip.MustParsePrefix("fd00:1:2::/48")})

	m := ask(t, s, "9.0.77.10.in-addr.arpa.", dnsmessage.TypePTR)
	assert.Equal(t, dnsmessage.RCodeSuccess, m.RCode)
	require.Len(t, m.Answers, 1)
	assert.Equal(t, "laptop.internal.", m.Answers[0].Body.(*dnsmessage.PTRResource).PTR.String())

	m = ask(t, s, "9.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.2.0.0.0.1.0.0.0.0.0.d.f.ip6.arpa.", dnsmessage.TypePTR)
	require.Len(t, m.Answers, 1)
	assert.Equal(t, "laptop.internal.", m.Answers[0].Body.(*dnsmessage.PTRResource).PTR.String())

	assert.Equal(t, dnsmessage.RCodeNameError, ask(t, s, "99.0.77.10.in-addr.arpa.", dnsmessage.TypePTR).RCode, "free address")
	assert.Equal(t, dnsmessage.RCodeSuccess, ask(t, s, "77.10.in-addr.arpa.", dnsmessage.TypeSOA).RCode, "zone apex")
	assert.Equal(t, dnsmessage.RCodeRefused, ask(t, s, "9.0.78.10.in-addr.arpa.", dnsmessage.TypePTR).RCode, "outside the mesh")
}

func TestReverseZones(t *testing.T) {
	zones := func(cidrs ...string) []string {
		var prefixes []netip.Prefix
		for _, c := range cidrs {
			prefixes = append(prefixes, netip.MustParsePrefix(c))
		}
		return ReverseZones(prefixes)
	}
	assert.Equal(t, []string{"77.10.in-addr.arpa", "2.0.0.0.1.0.0.0.0.0.d.f.ip6.arpa"}, zones("10.77.0.0/16", "fd00:1:2::/48"))
	assert.Equal(t, []string{"10.in-addr.arpa"}, zones("10.0.0.0/8"))
	// Between octets: the longer zones inside, never 168.192 as a whole.
	assert.Equal(t, []string{"0.168.192.in-addr.arpa", "1.168.192.in-addr.arpa", "2.168.192.in-addr.arpa", "3.168.192.in-addr.arpa"},
		zones("192.168.0.0/22"))
	assert.Len(t, zones("172.16.0.0/12"), 16)
	assert.Equal(t, "31.172.in-addr.arpa", zones("172.16.0.0/12")[15])
	assert.Equal(t, []string{"10.in-addr.arpa", "11.in-addr.arpa"}, zones("10.0.0.0/7"))
	assert.Empty(t, zones("0.0.0.0/0"), "never every address")
}

// queryPacket is a query as the OS sends it into the TUN.
func queryPacket(t *testing.T, name string, qtype dnsmessage.Type) []byte {
	return udpPacket(netip.MustParseAddrPort("10.77.0.2:40000"), netip.AddrPortFrom(ResolverAddr, 53), query(t, name, qtype))
}

func TestHandlesPacketsForTheResolver(t *testing.T) {
	s := testServer()

	reply, handled := s.HandlePacket(queryPacket(t, "laptop.internal.", dnsmessage.TypeA))
	require.True(t, handled)
	require.NotNil(t, reply)
	assert.Equal(t, uint16(0), fold(sum(0, reply[:ipv4HeaderLen]))^0xffff, "IP checksum")
	assert.Equal(t, ResolverAddr, netip.AddrFrom4([4]byte(reply[12:16])))
	assert.Equal(t, netip.MustParseAddr("10.77.0.2"), netip.AddrFrom4([4]byte(reply[16:20])))
	udp := reply[ipv4HeaderLen:]
	assert.Equal(t, uint16(53), binary.BigEndian.Uint16(udp[0:2]))
	assert.Equal(t, uint16(40000), binary.BigEndian.Uint16(udp[2:4]))
	pseudo := sum(0, reply[12:20]) + protoUDP + uint32(len(udp))
	assert.Equal(t, uint16(0xffff), fold(sum(pseudo, udp)), "UDP checksum")
	var m dnsmessage.Message
	require.NoError(t, m.Unpack(udp[udpHeaderLen:]))
	require.Len(t, m.Answers, 1)
	assert.Equal(t, [4]byte{10, 77, 0, 9}, m.Answers[0].Body.(*dnsmessage.AResource).A)

	// To a peer: not ours.
	other := udpPacket(netip.MustParseAddrPort("10.77.0.2:40000"), netip.MustParseAddrPort("10.77.0.9:53"), query(t, "laptop.internal.", dnsmessage.TypeA))
	_, handled = s.HandlePacket(other)
	assert.False(t, handled)

	// To the resolver but not a UDP query on 53: dropped, no reply.
	wrongPort := udpPacket(netip.MustParseAddrPort("10.77.0.2:40000"), netip.AddrPortFrom(ResolverAddr, 54), query(t, "laptop.internal.", dnsmessage.TypeA))
	reply, handled = s.HandlePacket(wrongPort)
	assert.True(t, handled)
	assert.Nil(t, reply)
	_, handled = s.HandlePacket([]byte{0x60, 0, 0, 0})
	assert.False(t, handled, "IPv6")
}
