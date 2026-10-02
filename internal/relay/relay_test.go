package relay

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func newKey(t *testing.T) [32]byte {
	t.Helper()
	var k [32]byte
	_, err := rand.Read(k[:])
	require.NoError(t, err)
	return k
}

func startRelay(t *testing.T) (*Server, string) {
	t.Helper()
	srv, err := NewServer()
	require.NoError(t, err)
	hs := httptest.NewServer(srv)
	t.Cleanup(hs.Close)
	return srv, "ws" + strings.TrimPrefix(hs.URL, "http")
}

func connect(t *testing.T, ctx context.Context, url string, private [32]byte) (*Client, chan Packet) {
	t.Helper()
	c, err := NewClient(url, private)
	require.NoError(t, err)
	got := make(chan Packet, 8)
	c.Deliver = func(p Packet) { got <- p }
	go c.Run(ctx)
	require.Eventually(t, c.Connected, 3*time.Second, 10*time.Millisecond)
	return c, got
}

func TestRelayForwardsBetweenClients(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	srv, url := startRelay(t)

	aPriv, bPriv := newKey(t), newKey(t)
	a, _ := connect(t, ctx, url, aPriv)
	_, bGot := connect(t, ctx, url, bPriv)
	require.Eventually(t, func() bool { return srv.Clients() == 2 }, time.Second, 10*time.Millisecond)

	aPub, _ := PublicKey(aPriv)
	bPub, _ := PublicKey(bPriv)
	require.NoError(t, a.Send(ctx, bPub, []byte("wireguard ciphertext")))

	select {
	case p := <-bGot:
		assert.Equal(t, aPub, p.From, "receiver learns the sender's key")
		assert.Equal(t, []byte("wireguard ciphertext"), p.Data)
	case <-time.After(3 * time.Second):
		t.Fatal("packet not forwarded")
	}
}

func TestRelayRejectsKeyWithoutPrivateKey(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	srv, url := startRelay(t)

	victim, _ := PublicKey(newKey(t))
	conn, _, err := websocket.Dial(ctx, url, nil)
	require.NoError(t, err)
	defer conn.CloseNow()

	// Claim the victim's key, then answer the challenge with a different key.
	require.NoError(t, writeJSON(ctx, conn, hello{PublicKey: victim[:]}))
	var ch challenge
	require.NoError(t, readJSON(ctx, conn, &ch))
	p, err := sealProof(ch.Challenge, Key(ch.ServerKey), newKey(t))
	require.NoError(t, err)
	require.NoError(t, writeJSON(ctx, conn, p))

	var w json.RawMessage
	assert.Error(t, readJSON(ctx, conn, &w), "server must close instead of welcoming")
	assert.Equal(t, 0, srv.Clients())
}

func TestNewestConnectionWins(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	srv, url := startRelay(t)
	priv := newKey(t)

	firstCtx, stopFirst := context.WithCancel(ctx)
	defer stopFirst()
	connect(t, firstCtx, url, priv)
	connect(t, ctx, url, priv)
	assert.Eventually(t, func() bool { return srv.Clients() == 1 }, time.Second, 10*time.Millisecond)
}

func TestReconnectRedialsRightAway(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	srv, err := NewServer()
	require.NoError(t, err)
	var dials atomic.Int32
	hs := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		dials.Add(1)
		srv.ServeHTTP(w, r)
	}))
	t.Cleanup(hs.Close)
	url := "ws" + strings.TrimPrefix(hs.URL, "http")

	c, _ := connect(t, ctx, url, newKey(t))
	require.Equal(t, int32(1), dials.Load())

	c.Reconnect()
	// Well under the 1s backoff: the redial skipped it.
	require.Eventually(t, func() bool { return dials.Load() == 2 && c.Connected() }, 700*time.Millisecond, 10*time.Millisecond)
	assert.Eventually(t, func() bool { return srv.Clients() == 1 }, time.Second, 10*time.Millisecond)
}

func TestFrames(t *testing.T) {
	var k Key
	k[0] = 7
	key, packet, err := DecodeFrame(EncodeFrame(k, []byte{1, 2, 3}))
	require.NoError(t, err)
	assert.Equal(t, k, key)
	assert.Equal(t, []byte{1, 2, 3}, packet)

	_, _, err = DecodeFrame(make([]byte, KeyLen))
	assert.Error(t, err, "key without packet")
}
