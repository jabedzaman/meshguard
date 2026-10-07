package relay

import (
	"context"
	"crypto/ed25519"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// tokenSeed and the expected token are shared with "matches the Go relay's
// token" in packages/server-core/src/lib/relay-token.test.ts.
var tokenSeed = []byte("meshguard relay token test seed!")

const tokenVector = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8AAAAAa0nSAE6KW3P3EEBJFa_SkxIcjTa-5udWIeLoeurNqPAu1peF7AMC2uY70lXmrCmvSM-8G3QAcg_hAH0vTbDAzFGd_QQ"

func TestTokenVector(t *testing.T) {
	signer := ed25519.NewKeyFromSeed(tokenSeed)
	var key Key
	for i := range key {
		key[i] = byte(i)
	}
	token := SignToken(signer, key, time.Unix(1_800_000_000, 0))
	assert.Equal(t, tokenVector, token)

	exp, ok := VerifyToken(signer.Public().(ed25519.PublicKey), token, key, time.Unix(1_799_999_999, 0))
	assert.True(t, ok)
	assert.Equal(t, int64(1_800_000_000), exp.Unix())
}

func TestVerifyToken(t *testing.T) {
	signer := ed25519.NewKeyFromSeed(tokenSeed)
	trust := signer.Public().(ed25519.PublicKey)
	key, _ := PublicKey(newKey(t))
	now := time.Now()
	token := SignToken(signer, key, now.Add(time.Hour))

	_, ok := VerifyToken(trust, token, key, now)
	assert.True(t, ok)

	other, _ := PublicKey(newKey(t))
	_, ok = VerifyToken(trust, token, other, now)
	assert.False(t, ok, "another key")

	_, ok = VerifyToken(trust, token, key, now.Add(2*time.Hour))
	assert.False(t, ok, "expired")

	_, otherSigner, _ := ed25519.GenerateKey(nil)
	_, ok = VerifyToken(trust, SignToken(otherSigner, key, now.Add(time.Hour)), key, now)
	assert.False(t, ok, "signed by someone else")

	tampered := []byte(token)
	tampered[len(tampered)-5] ^= 1
	_, ok = VerifyToken(trust, string(tampered), key, now)
	assert.False(t, ok, "tampered")

	_, ok = VerifyToken(trust, "", key, now)
	assert.False(t, ok, "missing")
}

func startTrustedRelay(t *testing.T) (*Server, string, ed25519.PrivateKey) {
	t.Helper()
	signer := ed25519.NewKeyFromSeed(tokenSeed)
	srv, err := NewServer()
	require.NoError(t, err)
	srv.Trust = signer.Public().(ed25519.PublicKey)
	hs := httptest.NewServer(srv)
	t.Cleanup(hs.Close)
	return srv, "ws" + strings.TrimPrefix(hs.URL, "http"), signer
}

func TestTrustedRelayRefusesClientsWithoutToken(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	srv, url, _ := startTrustedRelay(t)

	c, err := NewClient(url, newKey(t))
	require.NoError(t, err)
	go c.Run(ctx)
	time.Sleep(300 * time.Millisecond)
	assert.False(t, c.Connected())
	assert.Zero(t, srv.Clients())
}

func TestTrustedRelayServesClientsWithToken(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	srv, url, signer := startTrustedRelay(t)

	aPriv, bPriv := newKey(t), newKey(t)
	aPub, _ := PublicKey(aPriv)
	bPub, _ := PublicKey(bPriv)
	a, err := NewClient(url, aPriv)
	require.NoError(t, err)
	a.SetToken(SignToken(signer, aPub, time.Now().Add(time.Hour)))
	go a.Run(ctx)
	b, err := NewClient(url, bPriv)
	require.NoError(t, err)
	b.SetToken(SignToken(signer, bPub, time.Now().Add(time.Hour)))
	got := make(chan Packet, 1)
	b.Deliver = func(p Packet) { got <- p }
	go b.Run(ctx)
	require.Eventually(t, func() bool { return srv.Clients() == 2 }, 3*time.Second, 10*time.Millisecond)
	require.Eventually(t, a.Connected, time.Second, 10*time.Millisecond)

	require.NoError(t, a.Send(ctx, bPub, []byte("ciphertext")))
	select {
	case p := <-got:
		assert.Equal(t, aPub, p.From)
	case <-time.After(3 * time.Second):
		t.Fatal("packet not forwarded")
	}
}

func TestTrustedRelayDropsExpiredTokensUnlessRefreshed(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	srv, url, signer := startTrustedRelay(t)

	expiring, refreshed := newKey(t), newKey(t)
	ePub, _ := PublicKey(expiring)
	rPub, _ := PublicKey(refreshed)
	// Tokens hold whole seconds: these expire within 1-2s.
	soon := time.Now().Add(2 * time.Second)

	e, err := NewClient(url, expiring)
	require.NoError(t, err)
	e.SetToken(SignToken(signer, ePub, soon))
	go e.Run(ctx)
	r, err := NewClient(url, refreshed)
	require.NoError(t, err)
	r.SetToken(SignToken(signer, rPub, soon))
	go r.Run(ctx)
	require.Eventually(t, func() bool { return srv.Clients() == 2 }, 3*time.Second, 10*time.Millisecond)
	require.Eventually(t, r.Connected, time.Second, 10*time.Millisecond)

	r.SetToken(SignToken(signer, rPub, time.Now().Add(time.Hour)))
	require.Eventually(t, func() bool { return srv.Clients() == 1 }, 4*time.Second, 50*time.Millisecond)
	srv.mu.Lock()
	_, stillServed := srv.clients[rPub]
	srv.mu.Unlock()
	assert.True(t, stillServed, "the refreshed client stays")
}

func TestTokenWithPublicNames(t *testing.T) {
	signer := ed25519.NewKeyFromSeed(tokenSeed)
	trust := signer.Public().(ed25519.PublicKey)
	key, _ := PublicKey(newKey(t))
	now := time.Now()

	token := SignToken(signer, key, now.Add(time.Hour), "Laptop.Brave-Otter.mesh.example.com", "b.example.com")
	claims, ok := VerifyTokenClaims(trust, token, key, now)
	require.True(t, ok)
	assert.Equal(t, []string{"laptop.brave-otter.mesh.example.com", "b.example.com"}, claims.Hostnames)
	assert.Equal(t, now.Add(time.Hour).Unix(), claims.Expires.Unix())
	_, ok = VerifyToken(trust, token, key, now)
	assert.True(t, ok, "the plain check accepts it too")

	plain, ok := VerifyTokenClaims(trust, SignToken(signer, key, now.Add(time.Hour)), key, now)
	require.True(t, ok)
	assert.Empty(t, plain.Hostnames)

	// The names can't be stripped or changed without the signature failing.
	raw := []byte(token)
	raw[len(raw)-90] ^= 1
	_, ok = VerifyTokenClaims(trust, string(raw), key, now)
	assert.False(t, ok)
}

const tokenWithNamesVector = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8AAAAAa0nSAAINYS5leGFtcGxlLmNvbQ1iLmV4YW1wbGUuY29tZfKTS-r2hYKPO5PPQ3ENWLZP1mSUj4xfkwlo6NwtZdMRuO8cco56ceyudAAy_jw7aINbvVxqbKDnALa-EsDLAA"

// tokenWithNamesVector is shared with "matches the Go relay's token with names" in
// packages/server-core/src/lib/relay-token.test.ts.
func TestTokenWithNamesVector(t *testing.T) {
	signer := ed25519.NewKeyFromSeed(tokenSeed)
	var key Key
	for i := range key {
		key[i] = byte(i)
	}
	token := SignToken(signer, key, time.Unix(1_800_000_000, 0), "a.example.com", "b.example.com")
	assert.Equal(t, tokenWithNamesVector, token)
}
