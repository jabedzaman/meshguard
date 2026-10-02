package disco

import (
	"crypto/rand"
	"net/netip"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/crypto/curve25519"
)

func keypair(t *testing.T) ([32]byte, Key) {
	t.Helper()
	var priv [32]byte
	_, err := rand.Read(priv[:])
	require.NoError(t, err)
	pub, err := curve25519.X25519(priv[:], curve25519.Basepoint)
	require.NoError(t, err)
	return priv, Key(pub)
}

// net is a fake network: packets to an address are handed to that node's
// manager, appearing to come from the sender's (possibly NAT-rewritten) address.
type fakeNet struct {
	mu    sync.Mutex
	nodes map[netip.AddrPort]*Manager
	from  map[*Manager]netip.AddrPort
	down  bool
}

func (n *fakeNet) sender(m **Manager) func(netip.AddrPort, []byte) error {
	return func(to netip.AddrPort, pkt []byte) error {
		n.mu.Lock()
		dst, ok := n.nodes[to]
		src := n.from[*m]
		down := n.down
		n.mu.Unlock()
		if ok && !down {
			dst.Handle(pkt, src)
		}
		return nil
	}
}

type clock struct{ t time.Time }

func (c *clock) now() time.Time      { return c.t }
func (c *clock) add(d time.Duration) { c.t = c.t.Add(d) }

func pair(t *testing.T) (a, b *Manager, aKey, bKey Key, n *fakeNet, c *clock) {
	aPriv, aPub := keypair(t)
	bPriv, bPub := keypair(t)
	n = &fakeNet{nodes: map[netip.AddrPort]*Manager{}, from: map[*Manager]netip.AddrPort{}}
	c = &clock{t: time.Unix(1_800_000_000, 0)}
	a = NewManager(aPriv, aPub, n.sender(&a))
	b = NewManager(bPriv, bPub, n.sender(&b))
	a.now, b.now = c.now, c.now
	// a is reachable at its public mapping 198.51.100.1:40001; b at 203.0.113.2:40002.
	aAddr, bAddr := netip.MustParseAddrPort("198.51.100.1:40001"), netip.MustParseAddrPort("203.0.113.2:40002")
	n.nodes[aAddr], n.nodes[bAddr] = a, b
	n.from[a], n.from[b] = aAddr, bAddr
	return a, b, aPub, bPub, n, c
}

func TestPingPongConfirmsDirectPath(t *testing.T) {
	a, b, aKey, bKey, _, _ := pair(t)
	unreachable := netip.MustParseAddrPort("10.0.0.9:51820") // b's LAN address, not routable from a
	a.SetPeers(map[Key][]netip.AddrPort{bKey: {unreachable, netip.MustParseAddrPort("203.0.113.2:40002")}})
	b.SetPeers(map[Key][]netip.AddrPort{aKey: {netip.MustParseAddrPort("198.51.100.1:40001")}})

	_, ok := a.Direct(bKey)
	assert.False(t, ok, "nothing confirmed before pinging")

	a.Tick()
	got, ok := a.Direct(bKey)
	require.True(t, ok)
	assert.Equal(t, "203.0.113.2:40002", got.String(), "the address the pong came from")
}

func TestPathExpiresWithoutPongs(t *testing.T) {
	a, b, aKey, bKey, n, c := pair(t)
	a.SetPeers(map[Key][]netip.AddrPort{bKey: {netip.MustParseAddrPort("203.0.113.2:40002")}})
	b.SetPeers(map[Key][]netip.AddrPort{aKey: nil})
	a.Tick()
	_, ok := a.Direct(bKey)
	require.True(t, ok)

	n.mu.Lock()
	n.down = true // NAT mapping gone
	n.mu.Unlock()
	for i := 0; i < 25; i++ {
		c.add(time.Second)
		a.Tick()
	}
	_, ok = a.Direct(bKey)
	assert.False(t, ok, "falls back once pongs stop")

	n.mu.Lock()
	n.down = false
	n.mu.Unlock()
	c.add(pingEvery)
	a.Tick()
	_, ok = a.Direct(bKey)
	assert.True(t, ok, "recovers when the path comes back")
}

func TestIgnoresUnknownPeersAndForgeries(t *testing.T) {
	a, b, _, bKey, n, _ := pair(t)
	a.SetPeers(map[Key][]netip.AddrPort{bKey: {netip.MustParseAddrPort("203.0.113.2:40002")}})
	// b doesn't know a: it must not answer pings from strangers.
	b.SetPeers(map[Key][]netip.AddrPort{})
	a.Tick()
	_, ok := a.Direct(bKey)
	assert.False(t, ok)

	// A pong sealed by someone else's key, claiming to be b, is rejected.
	evilPriv, _ := keypair(t)
	var evil *Manager
	evil = NewManager(evilPriv, bKey, n.sender(&evil)) // claims b's public key
	var tx txID
	forged, err := evil.seal(a.public, typePong, tx)
	require.NoError(t, err)
	assert.True(t, a.Handle(forged, netip.MustParseAddrPort("192.0.2.66:1")), "consumed as disco")
	_, ok = a.Direct(bKey)
	assert.False(t, ok, "forged pong must not set a path")
}

func TestNotDisco(t *testing.T) {
	a, _, _, _, _, _ := pair(t)
	assert.False(t, a.Handle([]byte{1, 0, 0, 0, 5}, netip.MustParseAddrPort("1.2.3.4:5")), "WireGuard packets pass through")
}

// After a NAT port clash, a's real mapping toward b isn't the address STUN
// reported. b learns it from a's ping and pings it back, confirming both ways.
func TestLearnsPeerAddressFromItsPings(t *testing.T) {
	a, b, aKey, bKey, n, c := pair(t)
	// b only knows a's (wrong, pre-clash) STUN address.
	stale := netip.MustParseAddrPort("198.51.100.1:51820")
	a.SetPeers(map[Key][]netip.AddrPort{bKey: {netip.MustParseAddrPort("203.0.113.2:40002")}})
	b.SetPeers(map[Key][]netip.AddrPort{aKey: {stale}})

	b.Tick()
	_, ok := b.Direct(aKey)
	assert.False(t, ok, "b can't reach a at the stale address")

	a.Tick() // a pings b; b learns a's real address 198.51.100.1:40001
	_, ok = a.Direct(bKey)
	assert.True(t, ok)

	c.add(time.Millisecond)
	b.Tick() // b pings the learned address immediately
	got, ok := b.Direct(aKey)
	require.True(t, ok)
	assert.Equal(t, n.from[a], got)
}

// b's network changes: it resets and pings a from a new address. a was
// confirmed on b's old address and moves to the new one.
func TestFollowsPeerToNewAddress(t *testing.T) {
	a, b, aKey, bKey, n, c := pair(t)
	a.SetPeers(map[Key][]netip.AddrPort{bKey: {n.from[b]}})
	b.SetPeers(map[Key][]netip.AddrPort{aKey: {n.from[a]}})
	a.Tick()
	_, ok := a.Direct(bKey)
	require.True(t, ok)

	moved := netip.MustParseAddrPort("203.0.113.77:41000")
	n.mu.Lock()
	delete(n.nodes, n.from[b])
	n.nodes[moved], n.from[b] = b, moved
	n.mu.Unlock()

	b.Reset()
	_, ok = b.Direct(aKey)
	assert.False(t, ok, "reset forgets confirmed paths")

	c.add(time.Millisecond)
	b.Tick() // pings a from the new address right away
	got, ok := b.Direct(aKey)
	require.True(t, ok)
	assert.Equal(t, n.from[a], got)

	c.add(time.Millisecond)
	a.Tick() // a pings the address b's ping came from
	got, ok = a.Direct(bKey)
	require.True(t, ok)
	assert.Equal(t, moved, got)
}

// b moves without a's knowing (no ping reaches a from the new address). Once
// the old path misses a keepalive, a tries b's new candidates from the
// network map instead of waiting for the old path to expire.
func TestSearchesWhenConfirmedPathGoesQuiet(t *testing.T) {
	a, b, aKey, bKey, n, c := pair(t)
	a.SetPeers(map[Key][]netip.AddrPort{bKey: {n.from[b]}})
	b.SetPeers(map[Key][]netip.AddrPort{aKey: nil})
	a.Tick()
	_, ok := a.Direct(bKey)
	require.True(t, ok)

	moved := netip.MustParseAddrPort("203.0.113.77:41000")
	n.mu.Lock()
	delete(n.nodes, n.from[b])
	n.nodes[moved], n.from[b] = b, moved
	n.mu.Unlock()
	a.SetPeers(map[Key][]netip.AddrPort{bKey: {moved}}) // learned from a sync

	for i := 0; i < 8; i++ {
		c.add(time.Second)
		a.Tick()
	}
	got, ok := a.Direct(bKey)
	require.True(t, ok)
	assert.Equal(t, moved, got, "found well before the old path expired")
}
