// Package identity holds a device's key pairs: an Ed25519 identity key the
// device signs control plane requests with, and a Curve25519 WireGuard key.
package identity

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"fmt"

	"golang.org/x/crypto/curve25519"
)

// Keys are a device's private keys. Public keys are derived from them.
type Keys struct {
	Identity  ed25519.PrivateKey
	WireGuard [32]byte
}

// Generate creates new identity and WireGuard key pairs.
func Generate() (*Keys, error) {
	_, identity, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, fmt.Errorf("generate identity key: %w", err)
	}
	var wg [32]byte
	if _, err := rand.Read(wg[:]); err != nil {
		return nil, fmt.Errorf("generate wireguard key: %w", err)
	}
	clamp(&wg)
	return &Keys{Identity: identity, WireGuard: wg}, nil
}

// clamp applies the Curve25519 private key clamping WireGuard expects.
func clamp(k *[32]byte) {
	k[0] &= 248
	k[31] = (k[31] & 127) | 64
}

// IdentityPublicKey is the base64 Ed25519 public key.
func (k *Keys) IdentityPublicKey() string {
	return base64.StdEncoding.EncodeToString(k.Identity.Public().(ed25519.PublicKey))
}

// WireGuardPublicKey is the base64 Curve25519 public key, as WireGuard prints it.
func (k *Keys) WireGuardPublicKey() (string, error) {
	pub, err := curve25519.X25519(k.WireGuard[:], curve25519.Basepoint)
	if err != nil {
		return "", fmt.Errorf("derive wireguard public key: %w", err)
	}
	return base64.StdEncoding.EncodeToString(pub), nil
}

// WireGuardPrivateKey is the base64 private key, as WireGuard configs expect.
func (k *Keys) WireGuardPrivateKey() string {
	return base64.StdEncoding.EncodeToString(k.WireGuard[:])
}
