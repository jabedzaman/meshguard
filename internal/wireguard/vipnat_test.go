package wireguard

import (
	"encoding/binary"
	"net/netip"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

var (
	natSelf   = netip.MustParseAddr("10.77.0.5")
	natVIP    = netip.MustParseAddr("10.77.9.9")
	natClient = netip.MustParseAddr("10.77.0.7")
)

// packet builds an IPv4 packet with a valid header and (for TCP/UDP) transport checksum.
func packet(proto uint8, src, dst netip.Addr, l4 []byte) []byte {
	b := make([]byte, 20, 20+len(l4))
	b[0] = 0x45
	binary.BigEndian.PutUint16(b[2:], uint16(20+len(l4)))
	b[8], b[9] = 64, proto
	s, d := src.As4(), dst.As4()
	copy(b[12:], s[:])
	copy(b[16:], d[:])
	b = append(b, l4...)
	switch proto {
	case ipProtoTCP:
		binary.BigEndian.PutUint16(b[20+16:], transportChecksum(b, 20))
	case ipProtoUDP:
		binary.BigEndian.PutUint16(b[20+6:], transportChecksum(b, 20))
	}
	binary.BigEndian.PutUint16(b[10:], headerChecksum(b[:20]))
	return b
}

// transportChecksum computes the TCP/UDP checksum with the checksum field zeroed.
func transportChecksum(b []byte, ihl int) uint16 {
	field := ihl + 16
	if b[9] == ipProtoUDP {
		field = ihl + 6
	}
	b[field], b[field+1] = 0, 0
	seg := b[ihl:]
	var s uint32
	add := func(p []byte) {
		for i := 0; i+1 < len(p); i += 2 {
			s += uint32(binary.BigEndian.Uint16(p[i:]))
		}
		if len(p)%2 == 1 {
			s += uint32(p[len(p)-1]) << 8
		}
	}
	add(b[12:20])
	s += uint32(b[9]) + uint32(len(seg))
	add(seg)
	for s>>16 != 0 {
		s = (s & 0xffff) + (s >> 16)
	}
	return ^uint16(s)
}

func tcpSegment(sport, dport uint16) []byte {
	seg := make([]byte, 24)
	binary.BigEndian.PutUint16(seg[0:], sport)
	binary.BigEndian.PutUint16(seg[2:], dport)
	seg[12] = 0x50
	copy(seg[20:], "data")
	return seg
}

func udpDatagram(sport, dport uint16) []byte {
	d := make([]byte, 12)
	binary.BigEndian.PutUint16(d[0:], sport)
	binary.BigEndian.PutUint16(d[2:], dport)
	binary.BigEndian.PutUint16(d[4:], 12)
	copy(d[8:], "data")
	return d
}

func echo(typ uint8, id uint16) []byte {
	b := make([]byte, 8)
	b[0] = typ
	binary.BigEndian.PutUint16(b[4:], id)
	binary.BigEndian.PutUint16(b[2:], ^uint16(uint16(typ)<<8)+0) // any value; ICMP checksum has no addresses
	return b
}

func valid(t *testing.T, b []byte) {
	t.Helper()
	assert.Equal(t, uint16(0), headerChecksum(b[:20]), "ip header checksum")
	switch b[9] {
	case ipProtoTCP, ipProtoUDP:
		field := 20 + 16
		if b[9] == ipProtoUDP {
			field = 20 + 6
		}
		got := binary.BigEndian.Uint16(b[field:])
		want := transportChecksum(append([]byte(nil), b...), 20)
		if b[9] == ipProtoUDP && want == 0 {
			want = 0xffff
		}
		assert.Equal(t, want, got, "transport checksum")
	}
}

func newTestNAT() *vipNAT {
	n := newVIPNAT(natSelf)
	n.set([]netip.Addr{natVIP})
	return n
}

func TestTCPToAServiceAddressReachesTheDeviceAndRepliesComeFromTheAddress(t *testing.T) {
	n := newTestNAT()

	request := packet(ipProtoTCP, natClient, natVIP, tcpSegment(40000, 8080))
	require.True(t, n.inbound(request))
	assert.Equal(t, natSelf.As4(), [4]byte(request[16:20]), "addressed to the device")
	assert.Equal(t, natClient.As4(), [4]byte(request[12:16]))
	valid(t, request)

	reply := packet(ipProtoTCP, natSelf, natClient, tcpSegment(8080, 40000))
	n.outbound(reply)
	assert.Equal(t, natVIP.As4(), [4]byte(reply[12:16]), "comes from the service address")
	valid(t, reply)
}

func TestUDPAndEcho(t *testing.T) {
	n := newTestNAT()

	req := packet(ipProtoUDP, natClient, natVIP, udpDatagram(5000, 53))
	require.True(t, n.inbound(req))
	valid(t, req)
	rep := packet(ipProtoUDP, natSelf, natClient, udpDatagram(53, 5000))
	n.outbound(rep)
	assert.Equal(t, natVIP.As4(), [4]byte(rep[12:16]))
	valid(t, rep)

	ping := packet(ipProtoICMP, natClient, natVIP, echo(8, 77))
	require.True(t, n.inbound(ping))
	assert.Equal(t, natSelf.As4(), [4]byte(ping[16:20]))
	valid(t, ping)
	pong := packet(ipProtoICMP, natSelf, natClient, echo(0, 77))
	n.outbound(pong)
	assert.Equal(t, natVIP.As4(), [4]byte(pong[12:16]))
}

func TestOnlyServiceTrafficIsRewritten(t *testing.T) {
	n := newTestNAT()

	direct := packet(ipProtoTCP, natClient, natSelf, tcpSegment(40000, 8080))
	assert.False(t, n.inbound(direct), "to the device itself")
	other := packet(ipProtoTCP, natClient, netip.MustParseAddr("10.77.0.9"), tcpSegment(40000, 8080))
	assert.False(t, n.inbound(other), "to another address")

	// A reply with no connection through the address stays as it is.
	reply := packet(ipProtoTCP, natSelf, natClient, tcpSegment(8080, 40000))
	before := append([]byte(nil), reply...)
	n.outbound(reply)
	assert.Equal(t, before, reply)

	// So does a reply on another port of a client that has a connection.
	require.True(t, n.inbound(packet(ipProtoTCP, natClient, natVIP, tcpSegment(40000, 8080))))
	other2 := packet(ipProtoTCP, natSelf, natClient, tcpSegment(9090, 40000))
	before = append([]byte(nil), other2...)
	n.outbound(other2)
	assert.Equal(t, before, other2)

	// An echo reply needs a matching request, and a request starts the flow.
	assert.False(t, n.inbound(packet(ipProtoICMP, natClient, natVIP, echo(0, 1))), "a reply starts nothing")
}

func TestFlowsExpireAndAddressesGoWithTheirService(t *testing.T) {
	n := newTestNAT()
	now := time.Unix(1000, 0)
	n.now = func() time.Time { return now }

	require.True(t, n.inbound(packet(ipProtoTCP, natClient, natVIP, tcpSegment(40000, 8080))))
	n.set(nil)
	reply := packet(ipProtoTCP, natSelf, natClient, tcpSegment(8080, 40000))
	before := append([]byte(nil), reply...)
	n.outbound(reply)
	assert.Equal(t, before, reply, "the service is gone")
	assert.False(t, n.inbound(packet(ipProtoTCP, natClient, natVIP, tcpSegment(40001, 8080))))

	n.set([]netip.Addr{natVIP})
	require.True(t, n.inbound(packet(ipProtoTCP, natClient, natVIP, tcpSegment(40000, 8080))))
	now = now.Add(natFlowTimeout + natSweepEvery + time.Second)
	require.True(t, n.inbound(packet(ipProtoTCP, natClient, natVIP, tcpSegment(40002, 8080)))) // sweeps
	n.mu.Lock()
	assert.Len(t, n.flows, 1)
	n.mu.Unlock()
}

func TestMalformedPackets(t *testing.T) {
	n := newTestNAT()
	assert.False(t, n.inbound(nil))
	assert.False(t, n.inbound([]byte{0x45, 0, 0}))
	v6 := make([]byte, 40)
	v6[0] = 0x60
	assert.False(t, n.inbound(v6))
	n.outbound(nil)
	n.outbound(v6)

	frag := packet(ipProtoTCP, natClient, natVIP, tcpSegment(1, 2))
	binary.BigEndian.PutUint16(frag[6:], 100)
	assert.False(t, n.inbound(frag), "later fragments have no ports")
}
