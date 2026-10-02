package dns

import (
	"context"
	"net"
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

func TestServesOverUDPAndTCP(t *testing.T) {
	s := testServer()
	addr := netip.MustParseAddrPort("127.0.0.1:0")
	// Pick a free port first; Start binds UDP and TCP to the same one.
	probe, err := net.ListenUDP("udp", net.UDPAddrFromAddrPort(addr))
	require.NoError(t, err)
	addr = probe.LocalAddr().(*net.UDPAddr).AddrPort()
	probe.Close()

	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	require.NoError(t, s.Start(ctx, addr))

	r := &net.Resolver{
		PreferGo: true,
		Dial: func(ctx context.Context, network, _ string) (net.Conn, error) {
			var d net.Dialer
			return d.DialContext(ctx, network, addr.String())
		},
	}
	ips, err := r.LookupNetIP(ctx, "ip4", "laptop.internal")
	require.NoError(t, err)
	assert.Equal(t, []netip.Addr{netip.MustParseAddr("10.77.0.9")}, ips)

	conn, err := net.Dial("tcp", addr.String())
	require.NoError(t, err)
	defer conn.Close()
	q := query(t, "laptop.internal.", dnsmessage.TypeA)
	_, err = conn.Write(append([]byte{0, byte(len(q))}, q...))
	require.NoError(t, err)
	buf := make([]byte, 512)
	n, err := conn.Read(buf)
	require.NoError(t, err)
	var m dnsmessage.Message
	require.NoError(t, m.Unpack(buf[2:n]))
	assert.Len(t, m.Answers, 1)
}
