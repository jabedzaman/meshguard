package dns

import (
	"fmt"
	"net/netip"
	"slices"
	"strconv"
	"strings"
)

// ReverseZones returns the reverse DNS zones covering prefixes, e.g.
// "77.10.in-addr.arpa" for 10.77.0.0/16. Reverse names only split on octets
// (IPv4) or nibbles (IPv6), so a prefix between boundaries becomes the
// longer zones inside it (at most 128, for an IPv4 /9), never a shorter one
// that would take over addresses outside the mesh.
func ReverseZones(prefixes []netip.Prefix) []string {
	var zones []string
	for _, p := range prefixes {
		p = p.Masked()
		step := 8
		if p.Addr().Is6() {
			step = 4
		}
		bits := (p.Bits() + step - 1) / step * step
		if !p.IsValid() || bits == 0 {
			continue
		}
		b := p.Addr().AsSlice()
		for range 1 << (bits - p.Bits()) {
			ip, _ := netip.AddrFromSlice(b)
			zones = append(zones, reverseName(ip, bits))
			increment(b, bits)
		}
	}
	return zones
}

// reverseName is the reverse DNS name of ip's first bits, e.g.
// "9.0.77.10.in-addr.arpa" for 10.77.0.9 and 32 bits.
func reverseName(ip netip.Addr, bits int) string {
	var labels []string
	b := ip.AsSlice()
	if ip.Is4() {
		for _, octet := range b[:bits/8] {
			labels = append(labels, strconv.Itoa(int(octet)))
		}
		slices.Reverse(labels)
		return strings.Join(append(labels, "in-addr.arpa"), ".")
	}
	for i := range bits / 4 {
		labels = append(labels, fmt.Sprintf("%x", b[i/2]>>(4*(1-i%2))&0xf))
	}
	slices.Reverse(labels)
	return strings.Join(append(labels, "ip6.arpa"), ".")
}

// parseReverse turns a full reverse name back into an address.
func parseReverse(name string) (netip.Addr, bool) {
	if rest, ok := strings.CutSuffix(name, ".in-addr.arpa"); ok {
		labels := strings.Split(rest, ".")
		if len(labels) != 4 {
			return netip.Addr{}, false
		}
		slices.Reverse(labels)
		ip, err := netip.ParseAddr(strings.Join(labels, "."))
		return ip, err == nil && ip.Is4()
	}
	if rest, ok := strings.CutSuffix(name, ".ip6.arpa"); ok {
		labels := strings.Split(rest, ".")
		if len(labels) != 32 {
			return netip.Addr{}, false
		}
		var b [16]byte
		for i, l := range labels {
			n, err := strconv.ParseUint(l, 16, 4)
			if err != nil || len(l) != 1 {
				return netip.Addr{}, false
			}
			// labels[0] is the last nibble.
			j := 31 - i
			b[j/2] |= byte(n) << (4 * (1 - j%2))
		}
		return netip.AddrFrom16(b), true
	}
	return netip.Addr{}, false
}

// increment adds one at bit position bits (counted from the left, 1-based)
// of the big-endian number b, i.e. steps to the next block of that size.
func increment(b []byte, bits int) {
	i := (bits - 1) / 8
	carry := uint16(1) << (7 - (bits-1)%8)
	for ; i >= 0 && carry > 0; i-- {
		sum := uint16(b[i]) + carry
		b[i] = byte(sum)
		carry = sum >> 8
	}
}
