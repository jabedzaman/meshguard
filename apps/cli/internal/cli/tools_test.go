package cli

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/jabedzaman/meshguard/internal/ipc"
)

var peers = []ipc.Peer{
	{Name: "Jabeds-MacBook-Air", MeshIPv4: "10.77.0.214", MeshIPv6: "fd00::214"},
	{Name: "thinkpad", DNSName: "thinkpad.brave-otter.lvh.me", MeshIPv4: "10.77.141.90"},
	{Name: "thinkcentre", MeshIPv4: "10.77.1.1"},
}

func TestFindPeer(t *testing.T) {
	p, err := findPeer(peers, "jabeds")
	require.NoError(t, err)
	assert.Equal(t, "Jabeds-MacBook-Air", p.Name, "case-insensitive unique prefix")

	p, err = findPeer(peers, "thinkpad")
	require.NoError(t, err)
	assert.Equal(t, "thinkpad", p.Name, "exact match wins over prefix")

	p, err = findPeer(peers, "ThinkPad.Brave-Otter.lvh.me.")
	require.NoError(t, err)
	assert.Equal(t, "thinkpad", p.Name, "by DNS name")

	p, err = findPeer(peers, "10.77.1.1")
	require.NoError(t, err)
	assert.Equal(t, "thinkcentre", p.Name, "by mesh IP")

	_, err = findPeer(peers, "think")
	assert.ErrorContains(t, err, "several peers")
	_, err = findPeer(peers, "nope")
	assert.ErrorContains(t, err, "no peer named")
}

func TestPath(t *testing.T) {
	assert.Equal(t, "relay", path(ipc.Peer{ViaRelay: true, Endpoint: "peer/ab"}))
	assert.Equal(t, "direct 1.2.3.4:51820", path(ipc.Peer{Endpoint: "1.2.3.4:51820"}))
	assert.Equal(t, "-", path(ipc.Peer{}))
}

func TestHandshake(t *testing.T) {
	assert.Equal(t, "never", handshake(ipc.Peer{}))
	at := time.Now().Add(-5 * time.Second)
	assert.Equal(t, "5s ago", handshake(ipc.Peer{LastHandshake: &at}))
}
