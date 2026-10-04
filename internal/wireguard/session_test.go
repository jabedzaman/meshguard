package wireguard

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"net"
	"net/netip"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"golang.org/x/crypto/curve25519"
	"golang.zx2c4.com/wireguard/conn"
	"golang.zx2c4.com/wireguard/device"
	"golang.zx2c4.com/wireguard/tun/tuntest"
)

type testDevice struct {
	dev    *device.Device
	tun    *tuntest.ChannelTUN
	public string // base64
	port   int
}

func newTestDevice(t *testing.T, addr string) *testDevice {
	t.Helper()
	var private [32]byte
	_, _ = rand.Read(private[:])
	public, err := curve25519.X25519(private[:], curve25519.Basepoint)
	require.NoError(t, err)

	l, err := net.ListenUDP("udp4", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1)})
	require.NoError(t, err)
	port := l.LocalAddr().(*net.UDPAddr).Port
	l.Close()

	tn := tuntest.NewChannelTUN()
	dev := device.NewDevice(tn.TUN(), conn.NewDefaultBind(), device.NewLogger(device.LogLevelError, addr+": "))
	require.NoError(t, dev.IpcSet(fmt.Sprintf("private_key=%s\nlisten_port=%d\n", hex.EncodeToString(private[:]), port)))
	require.NoError(t, dev.Up())
	t.Cleanup(dev.Close)
	return &testDevice{dev: dev, tun: tn, public: base64.StdEncoding.EncodeToString(public), port: port}
}

func lastHandshake(t *testing.T, d *testDevice) time.Time {
	t.Helper()
	raw, err := d.dev.IpcGet()
	require.NoError(t, err)
	for _, s := range parseStats(raw) {
		return s.LastHandshake
	}
	return time.Time{}
}

// A new endpoint for a peer (relay to direct, a new NAT mapping) must not
// tear down its session: replace_peers did, and the tunnel dropped until a
// new handshake.
func TestEndpointChangeKeepsSession(t *testing.T) {
	a, b := newTestDevice(t, "a"), newTestDevice(t, "b")
	aIP, bIP := netip.MustParseAddr("10.77.0.1"), netip.MustParseAddr("10.77.0.2")
	aPeers := []Peer{{PublicKey: b.public, Endpoint: fmt.Sprintf("127.0.0.1:%d", b.port), AllowedIPs: []netip.Prefix{netip.PrefixFrom(bIP, 32)}}}
	// Only a knows where to send, so only a starts a handshake: two at once
	// can race and lose packets.
	bPeers := []Peer{{PublicKey: a.public, AllowedIPs: []netip.Prefix{netip.PrefixFrom(aIP, 32)}}}
	for _, x := range []struct {
		d     *testDevice
		peers []Peer
	}{{b, bPeers}, {a, aPeers}} { // b first: a's first handshake must find it ready
		uapi, err := PeersUAPI(nil, x.peers)
		require.NoError(t, err)
		require.NoError(t, x.d.dev.IpcSet(uapi))
	}

	// The first packets may go before the handshake completes: resend.
	deadline := time.After(15 * time.Second)
	for through := false; !through; {
		a.tun.Outbound <- tuntest.Ping(bIP, aIP)
		select {
		case <-b.tun.Inbound:
			through = true
		case <-time.After(200 * time.Millisecond):
		case <-deadline:
			t.Fatal("no packet through the tunnel")
		}
	}
	before := lastHandshake(t, a)
	require.False(t, before.IsZero())

	// Same socket, new endpoint string: a different path to the same peer.
	moved := []Peer{aPeers[0]}
	moved[0].Endpoint = fmt.Sprintf("[::ffff:127.0.0.1]:%d", b.port)
	uapi, err := PeersUAPI(aPeers, moved)
	require.NoError(t, err)
	require.NoError(t, a.dev.IpcSet(uapi))
	require.Equal(t, before, lastHandshake(t, a), "session kept across the endpoint change")
}
