package discovery

import (
	"net"
	"net/netip"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestFilter(t *testing.T) {
	addrs := []netip.Addr{
		netip.MustParseAddr("fe80::1"),           // link-local
		netip.MustParseAddr("2001:db8::5"),       // global v6
		netip.MustParseAddr("127.0.0.1"),         // loopback
		netip.MustParseAddr("192.168.1.20"),      // LAN
		netip.MustParseAddr("10.77.0.9"),         // our mesh address
		netip.MustParseAddr("169.254.10.1"),      // link-local v4
		netip.MustParseAddr("::ffff:172.18.0.3"), // v4-mapped
	}
	exclude := []netip.Prefix{netip.MustParsePrefix("10.77.0.0/16")}

	assert.Equal(t,
		[]string{"192.168.1.20:51820", "172.18.0.3:51820", "[2001:db8::5]:51820"},
		Filter(addrs, 51820, exclude))
}

func TestEndpointsRuns(t *testing.T) {
	// Real interfaces vary by machine; just make sure nothing loopback leaks in.
	for _, ep := range Endpoints(51820, "", nil) {
		assert.NotContains(t, ep, "127.0.0.1")
	}
}

func TestDirectEndpoint(t *testing.T) {
	local := []netip.Prefix{netip.MustParsePrefix("192.168.1.0/24"), netip.MustParsePrefix("172.18.0.0/16")}

	assert.Equal(t, "172.18.0.4:51820",
		DirectEndpoint([]string{"10.0.0.5:51820", "172.18.0.4:51820"}, local), "first endpoint on a shared network")
	assert.Equal(t, "", DirectEndpoint([]string{"10.0.0.5:51820", "[2001:db8::1]:51820"}, local), "no shared network")
	assert.Equal(t, "", DirectEndpoint([]string{"garbage"}, local))
}

func TestUsable(t *testing.T) {
	up := net.FlagUp | net.FlagBroadcast | net.FlagMulticast
	assert.True(t, usable(up, "en0", "utun7"), "ethernet/wifi")
	assert.True(t, usable(up, "docker0", "mesh0"), "bridges are shared networks")
	assert.False(t, usable(net.FlagUp|net.FlagPointToPoint, "tailscale0", "mesh0"), "VPN tunnels are point-to-point")
	assert.False(t, usable(net.FlagUp|net.FlagPointToPoint, "utun3", "utun7"), "macOS VPN utun")
	assert.False(t, usable(up, "mesh0", "mesh0"), "our own interface")
	assert.False(t, usable(net.FlagUp|net.FlagLoopback, "lo", ""), "loopback")
	assert.False(t, usable(net.FlagBroadcast, "en1", ""), "down")
}
