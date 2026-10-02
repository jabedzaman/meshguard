package stun

import (
	"context"
	"encoding/hex"
	"net"
	"net/netip"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// RFC 5769 §2.2 sample IPv4 response: SOFTWARE "test vector", then
// XOR-MAPPED-ADDRESS 192.0.2.1:32853, MESSAGE-INTEGRITY and FINGERPRINT.
const rfc5769Response = "" +
	"0101003c2112a442b7e7a701bc34d686fa87dfae" + // header, transaction id
	"8022000b7465737420766563746f7220" + // SOFTWARE (11 bytes + 1 pad)
	"0020000800" + "01a147e112a643" + // XOR-MAPPED-ADDRESS
	"000800142b91f599fd9e90114c2aea2d9a0c7f31c99f6d63" + // MESSAGE-INTEGRITY
	"80280004c07d4c96" // FINGERPRINT

func TestParseRFC5769Response(t *testing.T) {
	b, err := hex.DecodeString(rfc5769Response)
	require.NoError(t, err)

	tx, addr, err := ParseResponse(b)
	require.NoError(t, err)
	assert.Equal(t, "b7e7a701bc34d686fa87dfae", hex.EncodeToString(tx[:]))
	assert.Equal(t, "192.0.2.1:32853", addr.String())
}

func TestRequestResponseRoundTrip(t *testing.T) {
	tx, req := Request()
	require.True(t, IsRequest(req))

	for _, from := range []string{"203.0.113.7:51820", "[2001:db8::42]:61000"} {
		resp, ok := Response(req, netip.MustParseAddrPort(from))
		require.True(t, ok)
		gotTx, addr, err := ParseResponse(resp)
		require.NoError(t, err)
		assert.Equal(t, tx, gotTx)
		assert.Equal(t, from, addr.String())
	}
}

func TestIsDoesNotMatchWireGuardOrDisco(t *testing.T) {
	wgHandshake := append([]byte{1, 0, 0, 0}, make([]byte, 144)...)
	assert.False(t, Is(wgHandshake))
	assert.False(t, Is([]byte("MSHDSC........................................")))
	_, req := Request()
	assert.True(t, Is(req))
	_, ok := Response(wgHandshake, netip.MustParseAddrPort("1.2.3.4:5"))
	assert.False(t, ok)
}

func TestServe(t *testing.T) {
	srv, err := net.ListenPacket("udp4", "127.0.0.1:0")
	require.NoError(t, err)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go Serve(ctx, srv)

	client, err := net.ListenPacket("udp4", "127.0.0.1:0")
	require.NoError(t, err)
	defer client.Close()
	tx, req := Request()
	_, err = client.WriteTo(req, srv.LocalAddr())
	require.NoError(t, err)

	require.NoError(t, client.SetReadDeadline(time.Now().Add(2*time.Second)))
	buf := make([]byte, 1500)
	n, _, err := client.ReadFrom(buf)
	require.NoError(t, err)
	gotTx, addr, err := ParseResponse(buf[:n])
	require.NoError(t, err)
	assert.Equal(t, tx, gotTx)
	assert.Equal(t, client.LocalAddr().String(), addr.String(), "reports the client's own address")
}
