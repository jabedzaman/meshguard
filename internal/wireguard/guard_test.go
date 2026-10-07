package wireguard

import (
	"net/netip"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

func toAddr(dst string) []byte {
	return packet(ipProtoTCP, netip.MustParseAddr("10.77.0.7"), netip.MustParseAddr(dst), tcpSegment(40000, 443))
}

func TestForwardGuardAllowsOnlyWhatTheDeviceResolved(t *testing.T) {
	now := time.Unix(1000, 0)
	g := newForwardGuard()
	g.now = func() time.Time { return now }
	mesh := []netip.Prefix{netip.MustParsePrefix("10.77.0.0/16")}
	served := []netip.Prefix{netip.MustParsePrefix("192.168.1.0/24")}

	// Off: everything passes, as for any device.
	assert.True(t, g.allow(toAddr("8.8.8.8")))

	g.configure(true, mesh, served)
	assert.True(t, g.allow(toAddr("10.77.0.9")), "the mesh")
	assert.True(t, g.allow(toAddr("192.168.1.20")), "a subnet it was approved to route")
	assert.False(t, g.allow(toAddr("8.8.8.8")), "an address nobody resolved")
	assert.False(t, g.allow(toAddr("93.184.216.34")))

	g.learn([]netip.Addr{netip.MustParseAddr("93.184.216.34")}, 90*time.Second)
	assert.True(t, g.allow(toAddr("93.184.216.34")), "resolved for a domain")
	assert.False(t, g.allow(toAddr("93.184.216.35")), "its neighbour")

	now = now.Add(89 * time.Second)
	assert.True(t, g.allow(toAddr("93.184.216.34")))
	now = now.Add(2 * time.Second)
	assert.False(t, g.allow(toAddr("93.184.216.34")), "forgotten when the lifetime ends")

	g.learn([]netip.Addr{netip.MustParseAddr("93.184.216.34")}, time.Minute)
	g.configure(false, nil, nil)
	g.configure(true, mesh, served)
	assert.False(t, g.allow(toAddr("93.184.216.34")), "turning it off forgets")

	assert.False(t, g.allow([]byte{0x45, 0, 0}), "malformed")
	assert.False(t, g.allow(nil))
}

func TestForwardGuardIPv6(t *testing.T) {
	g := newForwardGuard()
	g.configure(true, []netip.Prefix{netip.MustParsePrefix("fd00:1:2::/48")}, nil)
	to := func(dst string) []byte {
		b := make([]byte, 40)
		b[0] = 0x60
		d := netip.MustParseAddr(dst).As16()
		copy(b[24:], d[:])
		return b
	}
	assert.True(t, g.allow(to("fd00:1:2::9")))
	assert.False(t, g.allow(to("2001:db8::1")))
	g.learn([]netip.Addr{netip.MustParseAddr("2001:db8::1")}, time.Minute)
	assert.True(t, g.allow(to("2001:db8::1")))
}
