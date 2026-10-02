// Package stun implements the small part of STUN (RFC 5389) the agent needs:
// binding requests and reading the mapped (public) address from responses.
// Requests are sent from WireGuard's own socket, so the mapping applies to
// WireGuard traffic.
package stun

import (
	"crypto/rand"
	"encoding/binary"
	"errors"
	"net/netip"
)

const (
	headerLen    = 20
	magicCookie  = 0x2112A442
	bindingReq   = 0x0001
	bindingResp  = 0x0101
	attrMapped   = 0x0001
	attrXorMaped = 0x0020
)

// TxID identifies a request.
type TxID [12]byte

// Request builds a binding request.
func Request() (TxID, []byte) {
	var tx TxID
	_, _ = rand.Read(tx[:])
	b := make([]byte, headerLen)
	binary.BigEndian.PutUint16(b[0:], bindingReq)
	binary.BigEndian.PutUint16(b[2:], 0)
	binary.BigEndian.PutUint32(b[4:], magicCookie)
	copy(b[8:], tx[:])
	return tx, b
}

// Is reports whether b looks like a STUN message (first two bits zero and the
// magic cookie), which can't be confused with WireGuard or disco packets.
func Is(b []byte) bool {
	return len(b) >= headerLen && b[0]&0xc0 == 0 && binary.BigEndian.Uint32(b[4:]) == magicCookie
}

// IsRequest reports whether b is a binding request.
func IsRequest(b []byte) bool {
	return Is(b) && binary.BigEndian.Uint16(b[0:]) == bindingReq
}

// ParseResponse returns the transaction id and mapped address of a binding
// success response.
func ParseResponse(b []byte) (TxID, netip.AddrPort, error) {
	var tx TxID
	if !Is(b) || binary.BigEndian.Uint16(b[0:]) != bindingResp {
		return tx, netip.AddrPort{}, errors.New("not a STUN binding response")
	}
	copy(tx[:], b[8:20])
	length := int(binary.BigEndian.Uint16(b[2:]))
	if headerLen+length > len(b) {
		return tx, netip.AddrPort{}, errors.New("truncated STUN message")
	}
	attrs := b[headerLen : headerLen+length]

	var mapped netip.AddrPort
	for len(attrs) >= 4 {
		typ := binary.BigEndian.Uint16(attrs[0:])
		alen := int(binary.BigEndian.Uint16(attrs[2:]))
		if 4+alen > len(attrs) {
			break
		}
		val := attrs[4 : 4+alen]
		switch typ {
		case attrXorMaped:
			if ap, ok := parseAddress(val, tx, true); ok {
				return tx, ap, nil
			}
		case attrMapped:
			if ap, ok := parseAddress(val, tx, false); ok {
				mapped = ap
			}
		}
		attrs = attrs[4+((alen+3)&^3):] // attributes are padded to 4 bytes
	}
	if mapped.IsValid() {
		return tx, mapped, nil
	}
	return tx, netip.AddrPort{}, errors.New("no mapped address in STUN response")
}

func parseAddress(v []byte, tx TxID, xor bool) (netip.AddrPort, bool) {
	if len(v) < 8 {
		return netip.AddrPort{}, false
	}
	port := binary.BigEndian.Uint16(v[2:])
	if xor {
		port ^= magicCookie >> 16
	}
	switch v[1] {
	case 0x01: // IPv4
		ip := [4]byte(v[4:8])
		if xor {
			binary.BigEndian.PutUint32(ip[:], binary.BigEndian.Uint32(ip[:])^magicCookie)
		}
		return netip.AddrPortFrom(netip.AddrFrom4(ip), port), true
	case 0x02: // IPv6
		if len(v) < 20 {
			return netip.AddrPort{}, false
		}
		ip := [16]byte(v[4:20])
		if xor {
			var key [16]byte
			binary.BigEndian.PutUint32(key[:], magicCookie)
			copy(key[4:], tx[:])
			for i := range ip {
				ip[i] ^= key[i]
			}
		}
		return netip.AddrPortFrom(netip.AddrFrom16(ip), port), true
	}
	return netip.AddrPort{}, false
}

// Response builds a binding success response telling the requester its
// address, for the STUN server built into mesh-relay.
func Response(request []byte, from netip.AddrPort) ([]byte, bool) {
	if !IsRequest(request) {
		return nil, false
	}
	var tx TxID
	copy(tx[:], request[8:20])

	addr := from.Addr().Unmap()
	var attr []byte
	port := from.Port() ^ (magicCookie >> 16)
	if addr.Is4() {
		attr = make([]byte, 12)
		binary.BigEndian.PutUint16(attr[0:], attrXorMaped)
		binary.BigEndian.PutUint16(attr[2:], 8)
		attr[5] = 0x01
		binary.BigEndian.PutUint16(attr[6:], port)
		ip := addr.As4()
		binary.BigEndian.PutUint32(attr[8:], binary.BigEndian.Uint32(ip[:])^magicCookie)
	} else {
		attr = make([]byte, 24)
		binary.BigEndian.PutUint16(attr[0:], attrXorMaped)
		binary.BigEndian.PutUint16(attr[2:], 20)
		attr[5] = 0x02
		binary.BigEndian.PutUint16(attr[6:], port)
		ip := addr.As16()
		var key [16]byte
		binary.BigEndian.PutUint32(key[:], magicCookie)
		copy(key[4:], tx[:])
		for i := range ip {
			attr[8+i] = ip[i] ^ key[i]
		}
	}

	b := make([]byte, headerLen+len(attr))
	binary.BigEndian.PutUint16(b[0:], bindingResp)
	binary.BigEndian.PutUint16(b[2:], uint16(len(attr)))
	binary.BigEndian.PutUint32(b[4:], magicCookie)
	copy(b[8:], tx[:])
	copy(b[headerLen:], attr)
	return b, true
}
