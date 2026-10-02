package wireguard

import (
	"net"
	"net/netip"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.zx2c4.com/wireguard/conn"

	"github.com/twinlabshq/mesh/internal/relay"
)

func TestBindRoutesRelayEndpointsThroughRelay(t *testing.T) {
	b := NewBind(conn.NewDefaultBind())
	var key relay.Key
	key[0] = 0xaa

	ep, err := b.ParseEndpoint(RelayEndpointString(key))
	require.NoError(t, err)
	assert.Equal(t, "relay/aa"+strings.Repeat("00", 31), ep.DstToString())

	// No relay yet.
	assert.ErrorIs(t, b.Send([][]byte{{1}}, ep), errNoRelay)

	var sentTo relay.Key
	var sent [][]byte
	b.SetRelay(func(dst relay.Key, packet []byte) error {
		sentTo = dst
		sent = append(sent, append([]byte(nil), packet...))
		return nil
	})
	require.NoError(t, b.Send([][]byte{{1, 2}, {3}}, ep))
	assert.Equal(t, key, sentTo)
	assert.Equal(t, [][]byte{{1, 2}, {3}}, sent)
}

func TestBindParsesNormalEndpoints(t *testing.T) {
	b := NewBind(conn.NewDefaultBind())
	ep, err := b.ParseEndpoint("192.168.1.9:51820")
	require.NoError(t, err)
	assert.Equal(t, "192.168.1.9:51820", ep.DstToString())

	_, err = b.ParseEndpoint("relay/zz")
	assert.Error(t, err)
}

func TestBindReceivesRelayPackets(t *testing.T) {
	b := NewBind(conn.NewDefaultBind())
	fns, _, err := b.Open(0)
	require.NoError(t, err)
	receive := fns[len(fns)-1] // relay receiver is appended last

	var from relay.Key
	from[1] = 7
	b.Deliver(relay.Packet{From: from, Data: []byte("hello")})

	packets := [][]byte{make([]byte, 1500)}
	sizes := make([]int, 1)
	eps := make([]conn.Endpoint, 1)
	n, err := receive(packets, sizes, eps)
	require.NoError(t, err)
	assert.Equal(t, 1, n)
	assert.Equal(t, "hello", string(packets[0][:sizes[0]]))
	assert.Equal(t, RelayEndpointString(from), eps[0].DstToString(), "replies go back via the relay")

	// Close unblocks the receiver.
	done := make(chan error)
	go func() { _, err := receive(packets, sizes, eps); done <- err }()
	require.NoError(t, b.Close())
	assert.ErrorIs(t, <-done, net.ErrClosed)
}

func TestBindInterceptsBeforeWireGuard(t *testing.T) {
	// Two binds on localhost: a sends raw packets to b's UDP port.
	a := NewBind(conn.NewDefaultBind())
	b := NewBind(conn.NewDefaultBind())
	_, _, err := a.Open(0)
	require.NoError(t, err)
	defer a.Close()
	fns, port, err := b.Open(0)
	require.NoError(t, err)
	defer b.Close()

	var seen []string
	b.SetInterceptor(func(packet []byte, from netip.AddrPort) bool {
		if string(packet) == "disco" {
			seen = append(seen, from.Addr().String())
			return true
		}
		return false
	})

	to := netip.AddrPortFrom(netip.MustParseAddr("127.0.0.1"), port)
	require.NoError(t, a.SendTo(to, []byte("disco")))
	require.NoError(t, a.SendTo(to, []byte("wireguard")))

	// Read from all of b's UDP receivers at once (batch-sized buffers, as
	// WireGuard provides): the disco packet is consumed, the other reaches
	// "WireGuard".
	results := make(chan string, len(fns))
	for _, fn := range fns[:len(fns)-1] { // skip the relay receiver
		go func(fn conn.ReceiveFunc) {
			bs := b.BatchSize()
			packets := make([][]byte, bs)
			for i := range packets {
				packets[i] = make([]byte, 1500)
			}
			sizes := make([]int, bs)
			eps := make([]conn.Endpoint, bs)
			if n, err := fn(packets, sizes, eps); err == nil && n > 0 {
				results <- string(packets[0][:sizes[0]])
			}
		}(fn)
	}
	var got string
	select {
	case got = <-results:
	case <-time.After(2 * time.Second):
		t.Fatal("nothing reached WireGuard")
	}
	assert.Equal(t, "wireguard", got)
	assert.Equal(t, []string{"127.0.0.1"}, seen)
}
