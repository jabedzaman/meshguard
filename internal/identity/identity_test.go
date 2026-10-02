package identity

import (
	"crypto/ed25519"
	"encoding/base64"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGenerate(t *testing.T) {
	a, err := Generate()
	require.NoError(t, err)
	b, err := Generate()
	require.NoError(t, err)

	assert.NotEqual(t, a.IdentityPublicKey(), b.IdentityPublicKey(), "identity keys should differ")

	wgPublic, err := a.WireGuardPublicKey()
	require.NoError(t, err)
	for _, key := range []string{a.IdentityPublicKey(), wgPublic, a.WireGuardPrivateKey()} {
		raw, err := base64.StdEncoding.DecodeString(key)
		require.NoError(t, err, "key %q is not base64", key)
		assert.Len(t, raw, 32, "key %q", key)
	}
}

func TestWireGuardKeyIsClamped(t *testing.T) {
	k, err := Generate()
	require.NoError(t, err)

	assert.Zero(t, k.WireGuard[0]&7, "low 3 bits must be cleared")
	assert.Zero(t, k.WireGuard[31]&128, "high bit must be cleared")
	assert.NotZero(t, k.WireGuard[31]&64, "second-highest bit must be set")
}

func TestIdentitySigns(t *testing.T) {
	k, err := Generate()
	require.NoError(t, err)

	pub, err := base64.StdEncoding.DecodeString(k.IdentityPublicKey())
	require.NoError(t, err)
	msg := []byte("hello")
	assert.True(t, ed25519.Verify(pub, msg, ed25519.Sign(k.Identity, msg)),
		"signature should verify with the advertised public key")
}
