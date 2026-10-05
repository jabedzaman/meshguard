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

	"github.com/jabedzaman/meshguard/internal/relay"
)

func TestBindSendsPeerEndpointsThroughRelayWithoutDirectPath(t *testing.T) {
	b := NewBind(conn.NewDefaultBind())
	var key relay.Key
	key[0] = 0xaa

	ep, err := b.ParseEndpoint(PeerEndpointString(key))
	require.NoError(t, err)
	assert.Equal(t, "peer/aa"+strings.Repeat("00", 31), ep.DstToString())

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

	// An unconfirmed guess doesn't beat the relay.
	b.SetRouter(func(relay.Key) (netip.AddrPort, bool) {
		return netip.MustParseAddrPort("192.0.2.1:51820"), false
	})
	sent = nil
	require.NoError(t, b.Send([][]byte{{4}}, ep))
	assert.Equal(t, [][]byte{{4}}, sent)
}

// udpPair opens two binds on localhost and returns b's receive functions and
// address. Reading from them yields what a sent.
func udpPair(t *testing.T) (a, b *Bind, fns []conn.ReceiveFunc, bAddr netip.AddrPort) {
	t.Helper()
	a = NewBind(conn.NewDefaultBind())
	b = NewBind(conn.NewDefaultBind())
	_, _, err := a.Open(0)
	require.NoError(t, err)
	t.Cleanup(func() { a.Close() })
	fns, port, err := b.Open(0)
	require.NoError(t, err)
	t.Cleanup(func() { b.Close() })
	return a, b, fns[:len(fns)-1], netip.AddrPortFrom(netip.MustParseAddr("127.0.0.1"), port)
}

// receiveOne reads the first packet from any of fns.
func receiveOne(t *testing.T, b *Bind, fns []conn.ReceiveFunc) string {
	t.Helper()
	results := make(chan string, len(fns))
	for _, fn := range fns {
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
	select {
	case got := <-results:
		return got
	case <-time.After(2 * time.Second):
		t.Fatal("nothing received")
		return ""
	}
}

func TestBindSendsPeerEndpointsDirectWhenConfirmed(t *testing.T) {
	a, b, fns, bAddr := udpPair(t)
	var key relay.Key
	key[0] = 0xbb
	relayed := 0
	a.SetRelay(func(relay.Key, []byte) error { relayed++; return nil })
	a.SetRouter(func(k relay.Key) (netip.AddrPort, bool) {
		assert.Equal(t, key, k)
		return bAddr, true
	})

	require.NoError(t, a.Send([][]byte{[]byte("direct")}, &PeerEndpoint{Key: key}))
	assert.Equal(t, "direct", receiveOne(t, b, fns))
	assert.Zero(t, relayed, "a confirmed path skips the relay")
}

func TestBindTriesGuessWithoutRelay(t *testing.T) {
	a, b, fns, bAddr := udpPair(t)
	a.SetRouter(func(relay.Key) (netip.AddrPort, bool) { return bAddr, false })

	require.NoError(t, a.Send([][]byte{[]byte("guess")}, &PeerEndpoint{}))
	assert.Equal(t, "guess", receiveOne(t, b, fns))
}

func TestBindParsesNormalEndpoints(t *testing.T) {
	b := NewBind(conn.NewDefaultBind())
	ep, err := b.ParseEndpoint("192.168.1.9:51820")
	require.NoError(t, err)
	assert.Equal(t, "192.168.1.9:51820", ep.DstToString())

	_, err = b.ParseEndpoint("peer/zz")
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
	assert.Equal(t, PeerEndpointString(from), eps[0].DstToString(), "replies go back via the relay")

	// Close unblocks the receiver.
	done := make(chan error)
	go func() { _, err := receive(packets, sizes, eps); done <- err }()
	require.NoError(t, b.Close())
	assert.ErrorIs(t, <-done, net.ErrClosed)
}

func TestBindInterceptsBeforeWireGuard(t *testing.T) {
	a, b, fns, to := udpPair(t)
	var seen []string
	b.SetInterceptor(func(packet []byte, from netip.AddrPort) bool {
		if string(packet) == "disco" {
			seen = append(seen, from.Addr().String())
			return true
		}
		return false
	})

	require.NoError(t, a.SendTo(to, []byte("disco")))
	require.NoError(t, a.SendTo(to, []byte("wireguard")))

	// The disco packet is consumed, the other reaches "WireGuard".
	assert.Equal(t, "wireguard", receiveOne(t, b, fns))
	assert.Equal(t, []string{"127.0.0.1"}, seen)
}
