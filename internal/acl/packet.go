package acl

import (
	"encoding/binary"
	"net/netip"
)

// IP protocol numbers.
const (
	protoICMP   = 1
	protoTCP    = 6
	protoUDP    = 17
	protoICMPv6 = 58
)

// packet is what the filter needs from an IP header and the start of the
// transport header.
type packet struct {
	proto    uint8
	src, dst netip.Addr
	// Ports for TCP/UDP; for ICMP echo, srcPort and dstPort both hold the echo id.
	srcPort, dstPort uint16
	icmpType         uint8
	// A non-first fragment: no transport header to check.
	fragment bool
}

// parse reads an IPv4 or IPv6 packet. ok is false for anything malformed or
// truncated.
func parse(b []byte) (p packet, ok bool) {
	if len(b) < 1 {
		return p, false
	}
	var l4 []byte
	switch b[0] >> 4 {
	case 4:
		if len(b) < 20 {
			return p, false
		}
		ihl := int(b[0]&0x0f) * 4
		if ihl < 20 || len(b) < ihl {
			return p, false
		}
		p.proto = b[9]
		p.src = netip.AddrFrom4([4]byte(b[12:16]))
		p.dst = netip.AddrFrom4([4]byte(b[16:20]))
		if binary.BigEndian.Uint16(b[6:8])&0x1fff != 0 {
			p.fragment = true
			return p, true
		}
		l4 = b[ihl:]
	case 6:
		if len(b) < 40 {
			return p, false
		}
		p.src = netip.AddrFrom16([16]byte(b[8:24]))
		p.dst = netip.AddrFrom16([16]byte(b[24:40]))
		next, rest := b[6], b[40:]
	headers:
		for {
			switch next {
			case 0, 43, 60: // hop-by-hop, routing, destination options
				if len(rest) < 8 {
					return p, false
				}
				n := (int(rest[1]) + 1) * 8
				if len(rest) < n {
					return p, false
				}
				next, rest = rest[0], rest[n:]
			case 44: // fragment
				if len(rest) < 8 {
					return p, false
				}
				if binary.BigEndian.Uint16(rest[2:4])&0xfff8 != 0 {
					p.proto, p.fragment = rest[0], true
					return p, true
				}
				next, rest = rest[0], rest[8:]
			default:
				break headers
			}
		}
		p.proto, l4 = next, rest
	default:
		return p, false
	}

	switch p.proto {
	case protoTCP, protoUDP:
		if len(l4) < 4 {
			return p, false
		}
		p.srcPort = binary.BigEndian.Uint16(l4[0:2])
		p.dstPort = binary.BigEndian.Uint16(l4[2:4])
	case protoICMP, protoICMPv6:
		if len(l4) < 8 {
			return p, false
		}
		p.icmpType = l4[0]
		if p.isEchoRequest() || p.isEchoReply() {
			id := binary.BigEndian.Uint16(l4[4:6])
			p.srcPort, p.dstPort = id, id
		}
	}
	return p, true
}

func (p packet) isEchoRequest() bool {
	return (p.proto == protoICMP && p.icmpType == 8) || (p.proto == protoICMPv6 && p.icmpType == 128)
}

func (p packet) isEchoReply() bool {
	return (p.proto == protoICMP && p.icmpType == 0) || (p.proto == protoICMPv6 && p.icmpType == 129)
}

// isICMPError is an error about a packet we sent (unreachable, too big, time
// exceeded, parameter problem). Path MTU discovery needs these.
func (p packet) isICMPError() bool {
	switch p.proto {
	case protoICMP:
		return p.icmpType == 3 || p.icmpType == 11 || p.icmpType == 12
	case protoICMPv6:
		return p.icmpType >= 1 && p.icmpType <= 4
	}
	return false
}
