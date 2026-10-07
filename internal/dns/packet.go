package dns

import (
	"encoding/binary"
	"net/netip"
)

const (
	ipv4HeaderLen = 20
	udpHeaderLen  = 8
	protoUDP      = 17
	port          = 53
)

// HandlePacket takes an IP packet the OS sent into the TUN. UDP to port 53
// at Addr is the server's (handled is true, so it doesn't go on to peers),
// and reply is the IP packet to hand back to the OS. Anything else, even to
// that address, is left alone. Only UDP: the answers are small enough never
// to be truncated, so resolvers have no reason to retry over TCP.
func (s *Server) HandlePacket(packet []byte) (reply []byte, handled bool) {
	if len(packet) < ipv4HeaderLen || packet[0]>>4 != 4 || packet[9] != protoUDP {
		return nil, false
	}
	addr := s.Addr()
	if !addr.IsValid() || netip.AddrFrom4([4]byte(packet[16:20])) != addr {
		return nil, false
	}
	ihl := int(packet[0]&0xf) * 4
	total := int(binary.BigEndian.Uint16(packet[2:4]))
	if ihl < ipv4HeaderLen || total > len(packet) || total < ihl+udpHeaderLen {
		return nil, false
	}
	udp := packet[ihl:total]
	if binary.BigEndian.Uint16(udp[2:4]) != port {
		return nil, false
	}
	if binary.BigEndian.Uint16(packet[6:8])&0x3fff != 0 { // a fragment: MF or an offset
		return nil, true
	}
	length := int(binary.BigEndian.Uint16(udp[4:6]))
	if length < udpHeaderLen || length > len(udp) {
		return nil, true
	}
	query := udp[udpHeaderLen:length]
	from := netip.AddrPortFrom(netip.AddrFrom4([4]byte(packet[12:16])), binary.BigEndian.Uint16(udp[0:2]))
	if name, ok := QuestionName(query); ok {
		if forward, inject, ok := s.forwarding(name); ok {
			// The answer comes from a peer: don't hold up the TUN meanwhile.
			query = append([]byte(nil), query...)
			go func() {
				res := forward(query)
				if res == nil {
					res = Refused(query)
				}
				if res != nil {
					inject(udpPacket(netip.AddrPortFrom(addr, port), from, res))
				}
			}()
			return nil, true
		}
	}
	res, err := s.Answer(query)
	if err != nil {
		return nil, true
	}
	return udpPacket(netip.AddrPortFrom(addr, port), from, res), true
}

// udpPacket builds an IPv4 UDP packet with valid checksums.
func udpPacket(src, dst netip.AddrPort, payload []byte) []byte {
	total := ipv4HeaderLen + udpHeaderLen + len(payload)
	b := make([]byte, total)
	b[0] = 0x45 // IPv4, 20-byte header
	binary.BigEndian.PutUint16(b[2:4], uint16(total))
	binary.BigEndian.PutUint16(b[6:8], 0x4000) // don't fragment
	b[8] = 64                                  // TTL
	b[9] = protoUDP
	s4, d4 := src.Addr().As4(), dst.Addr().As4()
	copy(b[12:16], s4[:])
	copy(b[16:20], d4[:])
	binary.BigEndian.PutUint16(b[10:12], ^fold(sum(0, b[:ipv4HeaderLen])))

	udp := b[ipv4HeaderLen:]
	binary.BigEndian.PutUint16(udp[0:2], src.Port())
	binary.BigEndian.PutUint16(udp[2:4], dst.Port())
	binary.BigEndian.PutUint16(udp[4:6], uint16(len(udp)))
	copy(udp[udpHeaderLen:], payload)
	// Pseudo-header: addresses, protocol and UDP length.
	pseudo := sum(0, b[12:20]) + protoUDP + uint32(len(udp))
	check := ^fold(sum(pseudo, udp))
	if check == 0 {
		check = 0xffff // 0 means "no checksum" in UDP over IPv4
	}
	binary.BigEndian.PutUint16(udp[6:8], check)
	return b
}

// sum adds b as big-endian 16-bit words (RFC 1071), unfolded.
func sum(acc uint32, b []byte) uint32 {
	for len(b) >= 2 {
		acc += uint32(binary.BigEndian.Uint16(b))
		b = b[2:]
	}
	if len(b) == 1 {
		acc += uint32(b[0]) << 8
	}
	return acc
}

func fold(acc uint32) uint16 {
	for acc>>16 != 0 {
		acc = acc&0xffff + acc>>16
	}
	return uint16(acc)
}
