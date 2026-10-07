package relay

import (
	"bytes"
	"encoding/binary"
	"errors"
)

// Funnel streams carry TCP connections from the internet to an agent over the
// agent's relay WebSocket. They share its binary messages with WireGuard
// packets: a message whose key is all zeros (never a WireGuard key) is a
// stream frame instead:
//
//	zero key (32) || type (1) || stream id (4, big endian) || data
//
// The relay opens a stream for each connection it accepts for a name the
// agent may serve, sends the bytes the visitor sends (TLS passes through
// untouched), and closes it when either side does.
const (
	// FrameOpen starts a stream (relay → agent); data is the visitor's address.
	FrameOpen byte = 1
	// FrameData carries bytes of a stream, both ways.
	FrameData byte = 2
	// FrameClose ends a stream, both ways.
	FrameClose byte = 3
)

// MaxStreamData bounds the data in one frame; larger writes are split.
const MaxStreamData = 16 * 1024

var zeroKey Key

// StreamFrame is a decoded stream frame.
type StreamFrame struct {
	Type byte
	ID   uint32
	Data []byte
}

// EncodeStreamFrame builds a stream frame message.
func EncodeStreamFrame(f StreamFrame) []byte {
	out := make([]byte, KeyLen+1+4, KeyLen+1+4+len(f.Data))
	out[KeyLen] = f.Type
	binary.BigEndian.PutUint32(out[KeyLen+1:], f.ID)
	return append(out, f.Data...)
}

// IsStreamFrame reports whether a binary message is a stream frame.
func IsStreamFrame(msg []byte) bool {
	return len(msg) >= KeyLen+1+4 && bytes.Equal(msg[:KeyLen], zeroKey[:])
}

// DecodeStreamFrame parses a message IsStreamFrame accepted.
func DecodeStreamFrame(msg []byte) (StreamFrame, error) {
	if !IsStreamFrame(msg) {
		return StreamFrame{}, errors.New("not a stream frame")
	}
	f := StreamFrame{Type: msg[KeyLen], ID: binary.BigEndian.Uint32(msg[KeyLen+1:]), Data: msg[KeyLen+1+4:]}
	if f.Type < FrameOpen || f.Type > FrameClose || len(f.Data) > MaxStreamData+256 {
		return StreamFrame{}, errors.New("invalid stream frame")
	}
	return f, nil
}
