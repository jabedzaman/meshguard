package wireguard

import (
	"net/netip"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.zx2c4.com/wireguard/tun"

	"github.com/jabedzaman/meshguard/internal/acl"
)

// fakeTUN records written packets and returns queued ones on Read.
type fakeTUN struct {
	tun.Device
	written [][]byte
	toRead  [][]byte
}

func (f *fakeTUN) Write(bufs [][]byte, offset int) (int, error) {
	for _, b := range bufs {
		f.written = append(f.written, b[offset:])
	}
	return len(bufs), nil
}

func (f *fakeTUN) Read(bufs [][]byte, sizes []int, offset int) (int, error) {
	n := min(len(bufs), len(f.toRead))
	for i := range n {
		sizes[i] = copy(bufs[i][offset:], f.toRead[i])
	}
	f.toRead = f.toRead[n:]
	return n, nil
}

// udp4 is a minimal IPv4/UDP packet.
func udp4(src, dst string, sport, dport uint16) []byte {
	b := make([]byte, 28)
	b[0], b[9] = 0x45, 17
	s, d := netip.MustParseAddr(src).As4(), netip.MustParseAddr(dst).As4()
	copy(b[12:], s[:])
	copy(b[16:], d[:])
	b[20], b[21], b[22], b[23] = byte(sport>>8), byte(sport), byte(dport>>8), byte(dport)
	return b
}

func withOffset(offset int, packets ...[]byte) [][]byte {
	bufs := make([][]byte, len(packets))
	for i, p := range packets {
		bufs[i] = append(make([]byte, offset), p...)
	}
	return bufs
}

func TestFilteredTUNDropsDeniedPackets(t *testing.T) {
	inner := &fakeTUN{}
	filter := acl.NewFilter(acl.Policy{Rules: []acl.Rule{{Protocol: acl.UDP, PortFirst: 53, PortLast: 53}}})
	ft := &filteredTUN{Device: inner, filter: filter}

	allowed := udp4("10.77.0.2", "10.77.0.1", 1000, 53)
	denied := udp4("10.77.0.2", "10.77.0.1", 1000, 54)
	n, err := ft.Write(withOffset(16, denied, allowed, denied), 16)
	require.NoError(t, err)
	assert.Equal(t, 3, n, "dropped packets count as written")
	assert.Equal(t, [][]byte{allowed}, inner.written)
	assert.EqualValues(t, 2, filter.Dropped())
}

func TestFilteredTUNLetsRepliesIn(t *testing.T) {
	inner := &fakeTUN{toRead: [][]byte{udp4("10.77.0.1", "10.77.0.2", 5000, 9999)}}
	ft := &filteredTUN{Device: inner, filter: acl.NewFilter(acl.Policy{})}

	bufs, sizes := withOffset(16, make([]byte, 100)), make([]int, 1)
	n, err := ft.Read(bufs, sizes, 16)
	require.NoError(t, err)
	require.Equal(t, 1, n)

	reply := udp4("10.77.0.2", "10.77.0.1", 9999, 5000)
	_, err = ft.Write(withOffset(16, reply), 16)
	require.NoError(t, err)
	assert.Equal(t, [][]byte{reply}, inner.written)
}

func TestFilteredTUNAnswersLocalPackets(t *testing.T) {
	local := udp4("10.77.0.2", "10.77.0.53", 4000, 53)
	toPeer := udp4("10.77.0.2", "10.77.0.1", 4000, 53)
	inner := &fakeTUN{toRead: [][]byte{toPeer, local}}
	filter := acl.NewFilter(acl.Policy{})
	ft := &filteredTUN{Device: inner, filter: filter}
	answer := []byte("reply")
	h := LocalHandler(func(p []byte) ([]byte, bool) {
		if netip.AddrFrom4([4]byte(p[16:20])) != netip.MustParseAddr("10.77.0.53") {
			return nil, false
		}
		return answer, true
	})
	ft.local.Store(&h)

	bufs, sizes := withOffset(16, make([]byte, 100), make([]byte, 100)), make([]int, 2)
	n, err := ft.Read(bufs, sizes, 16)
	require.NoError(t, err)
	require.Equal(t, 2, n)
	assert.Equal(t, len(toPeer), sizes[0], "a peer's packet goes on to WireGuard")
	assert.Zero(t, sizes[1], "a local packet doesn't")
	assert.Equal(t, [][]byte{answer}, inner.written, "the reply goes back to the OS")
}
