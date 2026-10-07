package relay

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/binary"
	"strings"
	"time"
)

// Relay tokens let only devices the control plane vouches for use a relay.
// The control plane signs a device's WireGuard key and an expiry with its
// relay token key (RELAY_TOKEN_KEY); the relay checks the signature with the
// matching public key (RELAY_TRUST_KEY). Keep in sync with
// packages/server-core/src/lib/relay-token.ts.
//
// Token: base64url(key (32) || expiry unix seconds, big endian (8) [|| hostnames] || signature (64)),
// signed over tokenContext || everything before the signature. Hostnames are the
// public names (funnel) the control plane lets the device serve through the
// relay: a count (1) and, for each, a length (1) and the name. A token for a
// device with none ends after the expiry, so it is the same as before funnels.

const tokenContext = "meshguard-relay-token:"

const tokenLen = KeyLen + 8 + ed25519.SignatureSize

// MaxTokenHostnames bounds the public names in one token.
const MaxTokenHostnames = 8

// Claims is what a verified token allows.
type Claims struct {
	Expires time.Time
	// Public names the device may serve through the relay (lower case).
	Hostnames []string
}

// SignToken issues a token for key that expires at exp, letting the device
// serve hostnames (at most MaxTokenHostnames, each under 256 bytes) as well.
func SignToken(signer ed25519.PrivateKey, key Key, exp time.Time, hostnames ...string) string {
	body := tokenBody(key, exp)
	if len(hostnames) > 0 {
		body = append(body, byte(len(hostnames)))
		for _, h := range hostnames {
			body = append(body, byte(len(h)))
			body = append(body, h...)
		}
	}
	sig := ed25519.Sign(signer, append([]byte(tokenContext), body...))
	return base64.RawURLEncoding.EncodeToString(append(body, sig...))
}

// VerifyToken checks that token was signed by trust for key and hasn't
// expired, and returns its expiry.
func VerifyToken(trust ed25519.PublicKey, token string, key Key, now time.Time) (time.Time, bool) {
	claims, ok := VerifyTokenClaims(trust, token, key, now)
	return claims.Expires, ok
}

// VerifyTokenClaims is VerifyToken that also returns the public names.
func VerifyTokenClaims(trust ed25519.PublicKey, token string, key Key, now time.Time) (Claims, bool) {
	raw, err := base64.RawURLEncoding.DecodeString(token)
	if err != nil || len(raw) < tokenLen || Key(raw[:KeyLen]) != key {
		return Claims{}, false
	}
	body, sig := raw[:len(raw)-ed25519.SignatureSize], raw[len(raw)-ed25519.SignatureSize:]
	if !ed25519.Verify(trust, append([]byte(tokenContext), body...), sig) {
		return Claims{}, false
	}
	exp := time.Unix(int64(binary.BigEndian.Uint64(body[KeyLen:])), 0)
	if !now.Before(exp) {
		return Claims{}, false
	}
	claims := Claims{Expires: exp}
	if rest := body[KeyLen+8:]; len(rest) > 0 {
		names, ok := parseHostnames(rest)
		if !ok {
			return Claims{}, false
		}
		claims.Hostnames = names
	}
	return claims, true
}

func parseHostnames(b []byte) ([]string, bool) {
	count := int(b[0])
	b = b[1:]
	if count == 0 || count > MaxTokenHostnames {
		return nil, false
	}
	names := make([]string, 0, count)
	for range count {
		if len(b) < 1 || len(b) < 1+int(b[0]) || b[0] == 0 {
			return nil, false
		}
		n := int(b[0])
		names = append(names, strings.ToLower(string(b[1:1+n])))
		b = b[1+n:]
	}
	return names, len(b) == 0
}

func tokenBody(key Key, exp time.Time) []byte {
	body := make([]byte, KeyLen, KeyLen+8)
	copy(body, key[:])
	return binary.BigEndian.AppendUint64(body, uint64(exp.Unix()))
}
