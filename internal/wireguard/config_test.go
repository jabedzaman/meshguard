package wireguard

import (
	"encoding/base64"
	"net/netip"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func key(b byte) string {
	raw := make([]byte, 32)
	raw[0] = b
	return base64.StdEncoding.EncodeToString(raw)
}

func TestKeyToHex(t *testing.T) {
	hex, err := KeyToHex(key(0xab))
	require.NoError(t, err)
	assert.Equal(t, "ab"+strings.Repeat("00", 31), hex)

	_, err = KeyToHex("short")
	assert.Error(t, err)
}

func TestPeersUAPI(t *testing.T) {
	uapi, err := PeersUAPI([]Peer{
		{PublicKey: key(2), AllowedIPs: []netip.Prefix{netip.MustParsePrefix("10.77.0.3/32")}},
		{
			PublicKey: key(1),
			Endpoint:  "192.168.1.5:51820",
			AllowedIPs: []netip.Prefix{
				netip.MustParsePrefix("10.77.0.2/32"),
				netip.MustParsePrefix("fd00:1:2::2/128"),
			},
		},
	})
	require.NoError(t, err)
	// Sorted by key, endpoint only when known, allowed IPs replaced.
	assert.Equal(t, `replace_peers=true
public_key=01`+strings.Repeat("00", 31)+`
endpoint=192.168.1.5:51820
persistent_keepalive_interval=25
replace_allowed_ips=true
allowed_ip=10.77.0.2/32
allowed_ip=fd00:1:2::2/128
public_key=02`+strings.Repeat("00", 31)+`
persistent_keepalive_interval=25
replace_allowed_ips=true
allowed_ip=10.77.0.3/32
`, uapi)
}

func TestPeersUAPIEmptyRemovesAllPeers(t *testing.T) {
	uapi, err := PeersUAPI(nil)
	require.NoError(t, err)
	assert.Equal(t, "replace_peers=true\n", uapi)
}

func TestHostPrefix(t *testing.T) {
	p, err := HostPrefix("10.77.1.2")
	require.NoError(t, err)
	assert.Equal(t, "10.77.1.2/32", p.String())
	p, err = HostPrefix("fd00:1:2::9")
	require.NoError(t, err)
	assert.Equal(t, "fd00:1:2::9/128", p.String())
}

func TestParseStats(t *testing.T) {
	stats := parseStats(`private_key=aa
listen_port=51820
public_key=0101
endpoint=172.18.0.3:51820
last_handshake_time_sec=1800000000
last_handshake_time_nsec=5
rx_bytes=100
tx_bytes=200
public_key=0202
last_handshake_time_sec=0
last_handshake_time_nsec=0
rx_bytes=0
tx_bytes=0
`)
	require.Len(t, stats, 2)
	a := stats["0101"]
	assert.Equal(t, "172.18.0.3:51820", a.Endpoint)
	assert.Equal(t, int64(1800000000), a.LastHandshake.Unix())
	assert.Equal(t, uint64(100), a.RxBytes)
	assert.Equal(t, uint64(200), a.TxBytes)
	assert.True(t, stats["0202"].LastHandshake.IsZero(), "no handshake yet")
}
