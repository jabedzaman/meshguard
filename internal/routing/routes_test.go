package routing

import (
	"net/netip"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

var mesh = []netip.Prefix{netip.MustParsePrefix("10.77.0.0/16"), netip.MustParsePrefix("fd00:1:2::/48")}

func TestParsePrefixesNormalizesSortsAndDedupes(t *testing.T) {
	got, err := ParsePrefixes([]string{"192.168.1.5/24", "10.5.0.0/16", "192.168.1.0/24"}, mesh)
	require.NoError(t, err)
	assert.Equal(t, []string{"10.5.0.0/16", "192.168.1.0/24"}, Strings(got))
}

func TestParsePrefixesRejects(t *testing.T) {
	for name, route := range map[string]string{
		"garbage":      "lan",
		"no length":    "192.168.1.1",
		"default v4":   "0.0.0.0/0",
		"default v6":   "::/0",
		"mesh range":   "10.77.0.0/16",
		"inside mesh":  "10.77.4.0/24",
		"covers mesh":  "10.0.0.0/8",
		"loopback":     "127.0.0.0/8",
		"link local":   "169.254.0.0/16",
		"v6 mesh":      "fd00:1:2:5::/64",
		"multicast v6": "ff00::/8",
	} {
		_, err := ParsePrefixes([]string{route}, mesh)
		assert.Error(t, err, name)
	}
}

func TestParsePrefixesEmpty(t *testing.T) {
	got, err := ParsePrefixes(nil, mesh)
	require.NoError(t, err)
	assert.Empty(t, got)
	assert.NotNil(t, got)
}
