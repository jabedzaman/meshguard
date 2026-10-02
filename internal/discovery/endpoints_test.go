package discovery

import (
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
