// Package relay implements the relay protocol: agents behind NAT keep an
// outbound WebSocket to the relay, which forwards WireGuard packets between
// them by WireGuard public key. The relay only ever sees ciphertext.
//
// Handshake (JSON text messages):
//
//	client → hello     {publicKey, token}
//	server → challenge {serverKey, challenge}
//	client → proof     {nonce, sealed}   NaCl box of challenge, client→server keys
//	server → welcome   {}
//
// The token (see token.go) is the control plane's permission to use the
// relay; a relay with a trust key refuses clients without a valid one, and
// closes the connection when the token expires. The client sends a fresh one
// as {token} (text) while connected.
//
// Data (binary messages): 32-byte key + WireGuard packet. Client → server the
// key is the destination; server → client it is the sender.
package relay

import (
	"crypto/rand"
	"errors"

	"golang.org/x/crypto/curve25519"
	"golang.org/x/crypto/nacl/box"
)

// KeyLen is the length of a WireGuard (Curve25519) public key.
const KeyLen = 32

// Key is a WireGuard public key.
type Key [KeyLen]byte

// MaxPacket bounds a forwarded WireGuard packet (MTU plus overhead, with room).
const MaxPacket = 64 * 1024

type hello struct {
	PublicKey []byte `json:"publicKey"`
	Token     string `json:"token,omitempty"`
}

// refresh replaces the token of an open connection.
type refresh struct {
	Token string `json:"token"`
}

type challenge struct {
	ServerKey []byte `json:"serverKey"`
	Challenge []byte `json:"challenge"`
}

type proof struct {
	Nonce  []byte `json:"nonce"`
	Sealed []byte `json:"sealed"`
}

type welcome struct{}

// EncodeFrame prefixes a packet with a key.
func EncodeFrame(key Key, packet []byte) []byte {
	frame := make([]byte, KeyLen+len(packet))
	copy(frame, key[:])
	copy(frame[KeyLen:], packet)
	return frame
}

// DecodeFrame splits a frame into its key and packet.
func DecodeFrame(frame []byte) (Key, []byte, error) {
	var key Key
	if len(frame) <= KeyLen || len(frame) > KeyLen+MaxPacket {
		return key, nil, errors.New("invalid frame length")
	}
	copy(key[:], frame[:KeyLen])
	return key, frame[KeyLen:], nil
}

// PublicKey derives the public key for a private key.
func PublicKey(private [32]byte) (Key, error) {
	pub, err := curve25519.X25519(private[:], curve25519.Basepoint)
	var key Key
	copy(key[:], pub)
	return key, err
}

// sealProof proves possession of clientPrivate to the holder of serverPublic.
func sealProof(challengeBytes []byte, serverPublic Key, clientPrivate [32]byte) (proof, error) {
	var nonce [24]byte
	if _, err := rand.Read(nonce[:]); err != nil {
		return proof{}, err
	}
	sp := [32]byte(serverPublic)
	sealed := box.Seal(nil, challengeBytes, &nonce, &sp, &clientPrivate)
	return proof{Nonce: nonce[:], Sealed: sealed}, nil
}

// openProof checks that p was sealed by clientPublic's private key over want.
func openProof(p proof, want []byte, clientPublic Key, serverPrivate [32]byte) bool {
	if len(p.Nonce) != 24 {
		return false
	}
	var nonce [24]byte
	copy(nonce[:], p.Nonce)
	cp := [32]byte(clientPublic)
	opened, ok := box.Open(nil, p.Sealed, &nonce, &cp, &serverPrivate)
	if !ok || len(opened) != len(want) {
		return false
	}
	var diff byte
	for i := range want {
		diff |= opened[i] ^ want[i]
	}
	return diff == 0
}
