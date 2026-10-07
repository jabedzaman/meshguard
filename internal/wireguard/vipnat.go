package wireguard

import (
	"encoding/binary"
	"net/netip"
	"sync"
	"time"
)

// Service addresses (virtual IPs) are served by rewriting packets inside the
// TUN: a peer's packet to a service address this device hosts is addressed to
// the device's own mesh address before the OS sees it, and the OS's replies
// leave with the service address as their source. No host firewall is
// involved, so it works the same on every OS.

const (
	natFlowTimeout = 5 * time.Minute
	natSweepEvery  = 30 * time.Second
	natMaxFlows    = 1 << 16
)

const (
	ipProtoICMP = 1
	ipProtoTCP  = 6
	ipProtoUDP  = 17
)

// natFlow identifies a connection from a peer to a hosted service address as
// the replies look: the peer, protocol, the peer's port (or ICMP echo id) and
// the service port.
type natFlow struct {
	client                  netip.Addr
	proto                   uint8
	clientPort, servicePort uint16
}

type vipNAT struct {
	mu    sync.Mutex
	self  netip.Addr
	vips  map[netip.Addr]bool
	flows map[natFlow]natEntry
	last  time.Time
	now   func() time.Time
}

type natEntry struct {
	vip  netip.Addr
	seen time.Time
}

func newVIPNAT(self netip.Addr) *vipNAT {
	return &vipNAT{self: self, vips: map[netip.Addr]bool{}, flows: map[natFlow]natEntry{}, now: time.Now}
}

// set replaces the service addresses this device hosts. Flows to ones that
// are gone end with them.
func (n *vipNAT) set(vips []netip.Addr) {
	n.mu.Lock()
	defer n.mu.Unlock()
	next := make(map[netip.Addr]bool, len(vips))
	for _, v := range vips {
		next[v] = true
	}
	for k, e := range n.flows {
		if !next[e.vip] {
			delete(n.flows, k)
		}
	}
	n.vips = next
}

// ipv4 returns the IPv4 header length of an unfragmented packet.
func ipv4(b []byte) (ihl int, ok bool) {
	if len(b) < 20 || b[0]>>4 != 4 {
		return 0, false
	}
	ihl = int(b[0]&0x0f) * 4
	if ihl < 20 || len(b) < ihl {
		return 0, false
	}
	// Fragments after the first have no ports to look at.
	if binary.BigEndian.Uint16(b[6:8])&0x1fff != 0 {
		return 0, false
	}
	return ihl, true
}

// flowKey reads the connection a packet belongs to, from the peer's point of
// view: client is the peer's address.
func packetPorts(b []byte, ihl int) (srcPort, dstPort uint16, echoID uint16, ok bool) {
	switch b[9] {
	case ipProtoTCP, ipProtoUDP:
		if len(b) < ihl+4 {
			return 0, 0, 0, false
		}
		return binary.BigEndian.Uint16(b[ihl:]), binary.BigEndian.Uint16(b[ihl+2:]), 0, true
	case ipProtoICMP:
		if len(b) < ihl+8 {
			return 0, 0, 0, false
		}
		return 0, 0, binary.BigEndian.Uint16(b[ihl+4:]), true
	}
	return 0, 0, 0, false
}

// inbound rewrites a packet from a peer addressed to a hosted service
// address so it is for this device; it reports whether it did.
func (n *vipNAT) inbound(b []byte) bool {
	n.mu.Lock()
	defer n.mu.Unlock()
	if len(n.vips) == 0 {
		return false
	}
	ihl, ok := ipv4(b)
	if !ok {
		return false
	}
	dst, _ := netip.AddrFromSlice(b[16:20])
	if !n.vips[dst] {
		return false
	}
	src, _ := netip.AddrFromSlice(b[12:16])
	srcPort, dstPort, echoID, ok := packetPorts(b, ihl)
	if !ok {
		return false
	}
	key := natFlow{client: src, proto: b[9], clientPort: srcPort, servicePort: dstPort}
	switch b[9] {
	case ipProtoICMP:
		if b[ihl] != 8 { // only echo requests start a flow
			return false
		}
		key.clientPort, key.servicePort = echoID, 0
	}

	now := n.now()
	if now.Sub(n.last) >= natSweepEvery || len(n.flows) >= natMaxFlows {
		for k, e := range n.flows {
			if now.Sub(e.seen) > natFlowTimeout {
				delete(n.flows, k)
			}
		}
		n.last = now
		if len(n.flows) >= natMaxFlows {
			clear(n.flows)
		}
	}
	n.flows[key] = natEntry{vip: dst, seen: now}
	rewriteAddr(b, ihl, 16, n.self)
	return true
}

// outbound rewrites a reply from this device to a peer so it comes from the
// service address the peer connected to.
func (n *vipNAT) outbound(b []byte) {
	n.mu.Lock()
	defer n.mu.Unlock()
	if len(n.flows) == 0 {
		return
	}
	ihl, ok := ipv4(b)
	if !ok {
		return
	}
	if src, _ := netip.AddrFromSlice(b[12:16]); src != n.self {
		return
	}
	dst, _ := netip.AddrFromSlice(b[16:20])
	srcPort, dstPort, echoID, ok := packetPorts(b, ihl)
	if !ok {
		return
	}
	key := natFlow{client: dst, proto: b[9], clientPort: dstPort, servicePort: srcPort}
	if b[9] == ipProtoICMP {
		if b[ihl] != 0 { // echo reply
			return
		}
		key.clientPort, key.servicePort = echoID, 0
	}
	entry, ok := n.flows[key]
	if !ok {
		return
	}
	entry.seen = n.now()
	n.flows[key] = entry
	rewriteAddr(b, ihl, 12, entry.vip)
}

// rewriteAddr replaces the 4-byte address at b[off:off+4] and fixes the IP
// header checksum and the TCP/UDP checksum, which covers the addresses.
func rewriteAddr(b []byte, ihl, off int, to netip.Addr) {
	old := [4]byte(b[off : off+4])
	new4 := to.As4()
	copy(b[off:off+4], new4[:])

	var l4 int // offset of the transport checksum, 0 for none
	switch b[9] {
	case ipProtoTCP:
		l4 = ihl + 16
	case ipProtoUDP:
		l4 = ihl + 6
	}
	if l4 != 0 && len(b) >= l4+2 {
		sum := binary.BigEndian.Uint16(b[l4:])
		if b[9] != ipProtoUDP || sum != 0 { // UDP checksum 0: none
			for i := 0; i < 4; i += 2 {
				sum = adjustChecksum(sum, binary.BigEndian.Uint16(old[i:]), binary.BigEndian.Uint16(new4[i:]))
			}
			if b[9] == ipProtoUDP && sum == 0 {
				sum = 0xffff
			}
			binary.BigEndian.PutUint16(b[l4:], sum)
		}
	}
	b[10], b[11] = 0, 0
	binary.BigEndian.PutUint16(b[10:], headerChecksum(b[:ihl]))
}

// adjustChecksum updates a ones-complement checksum for one 16-bit word that
// changed from old to new (RFC 1624).
func adjustChecksum(sum, old, new uint16) uint16 {
	s := uint32(^sum) + uint32(^old) + uint32(new)
	s = (s & 0xffff) + (s >> 16)
	s = (s & 0xffff) + (s >> 16)
	return ^uint16(s)
}

func headerChecksum(h []byte) uint16 {
	var s uint32
	for i := 0; i+1 < len(h); i += 2 {
		s += uint32(binary.BigEndian.Uint16(h[i:]))
	}
	for s>>16 != 0 {
		s = (s & 0xffff) + (s >> 16)
	}
	return ^uint16(s)
}
