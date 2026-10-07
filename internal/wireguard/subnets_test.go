package wireguard

import (
	"net/netip"
	"testing"

	"github.com/stretchr/testify/assert"
)

func pfx(ss ...string) []netip.Prefix {
	var out []netip.Prefix
	for _, s := range ss {
		out = append(out, netip.MustParsePrefix(s))
	}
	return out
}

func TestDiffPrefixes(t *testing.T) {
	add, remove := diffPrefixes(pfx("10.1.0.0/16", "10.2.0.0/16"), pfx("10.2.0.0/16", "10.3.0.0/16"))
	assert.Equal(t, pfx("10.3.0.0/16"), add)
	assert.Equal(t, pfx("10.1.0.0/16"), remove)

	add, remove = diffPrefixes(nil, nil)
	assert.Empty(t, add)
	assert.Empty(t, remove)
}

func TestPeersUAPIAllowedIPsFollowRoutes(t *testing.T) {
	key := "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
	base := Peer{PublicKey: key, AllowedIPs: pfx("10.77.0.2/32")}
	routed := Peer{PublicKey: key, AllowedIPs: pfx("10.77.0.2/32", "192.168.50.0/24")}

	uapi, err := PeersUAPI([]Peer{base}, []Peer{routed})
	assert.NoError(t, err)
	assert.Contains(t, uapi, "replace_allowed_ips=true")
	assert.Contains(t, uapi, "allowed_ip=192.168.50.0/24")
	assert.Contains(t, uapi, "allowed_ip=10.77.0.2/32")

	uapi, err = PeersUAPI([]Peer{routed}, []Peer{routed})
	assert.NoError(t, err)
	assert.Empty(t, uapi, "no change, no update")
}
