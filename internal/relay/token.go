package relay

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/binary"
	"time"
)

// Relay tokens let only devices the control plane vouches for use a relay.
// The control plane signs a device's WireGuard key and an expiry with its
// relay token key (RELAY_TOKEN_KEY); the relay checks the signature with the
// matching public key (RELAY_TRUST_KEY). Keep in sync with
// packages/server-core/src/lib/relay-token.ts.
//
// Token: base64url(key (32) || expiry unix seconds, big endian (8) || signature (64)),
// signed over tokenContext || key || expiry.

const tokenContext = "meshguard-relay-token:"

const tokenLen = KeyLen + 8 + ed25519.SignatureSize

// SignToken issues a token for key that expires at exp.
func SignToken(signer ed25519.PrivateKey, key Key, exp time.Time) string {
	body := tokenBody(key, exp)
	sig := ed25519.Sign(signer, append([]byte(tokenContext), body...))
	return base64.RawURLEncoding.EncodeToString(append(body, sig...))
}

// VerifyToken checks that token was signed by trust for key and hasn't
// expired, and returns its expiry.
func VerifyToken(trust ed25519.PublicKey, token string, key Key, now time.Time) (time.Time, bool) {
	raw, err := base64.RawURLEncoding.DecodeString(token)
	if err != nil || len(raw) != tokenLen || Key(raw[:KeyLen]) != key {
		return time.Time{}, false
	}
	body, sig := raw[:KeyLen+8], raw[KeyLen+8:]
	if !ed25519.Verify(trust, append([]byte(tokenContext), body...), sig) {
		return time.Time{}, false
	}
	exp := time.Unix(int64(binary.BigEndian.Uint64(body[KeyLen:])), 0)
	if !now.Before(exp) {
		return time.Time{}, false
	}
	return exp, true
}

func tokenBody(key Key, exp time.Time) []byte {
	body := make([]byte, KeyLen, KeyLen+8)
	copy(body, key[:])
	return binary.BigEndian.AppendUint64(body, uint64(exp.Unix()))
}
