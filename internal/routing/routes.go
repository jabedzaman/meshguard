// Package routing validates the route prefixes a device advertises and
// accepts: subnet routes now, exit nodes later.
package routing

import (
	"fmt"
	"net/netip"
	"sort"
)

// ParsePrefixes parses CIDR strings into canonical prefixes (host bits
// cleared), sorted and without duplicates. mesh are the network's own ranges,
// which can't be advertised: they are already routed. A default route
// (0.0.0.0/0, ::/0) is an exit node, not a subnet route.
func ParsePrefixes(routes []string, mesh []netip.Prefix) ([]netip.Prefix, error) {
	seen := map[netip.Prefix]bool{}
	out := []netip.Prefix{}
	for _, raw := range routes {
		p, err := netip.ParsePrefix(raw)
		if err != nil {
			return nil, fmt.Errorf("invalid route %q: use CIDR notation such as 192.168.1.0/24", raw)
		}
		p = p.Masked()
		switch {
		case p.Bits() == 0:
			return nil, fmt.Errorf("route %s is a default route; that is an exit node, not a subnet", raw)
		case p.Addr().IsLoopback() || p.Addr().IsMulticast() || p.Addr().IsLinkLocalUnicast():
			return nil, fmt.Errorf("route %s is not a routable range", raw)
		}
		for _, m := range mesh {
			if m.Overlaps(p) {
				return nil, fmt.Errorf("route %s overlaps the mesh range %s", raw, m)
			}
		}
		if !seen[p] {
			seen[p] = true
			out = append(out, p)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].String() < out[j].String() })
	return out, nil
}

// Strings renders prefixes as CIDR strings.
func Strings(prefixes []netip.Prefix) []string {
	out := make([]string, len(prefixes))
	for i, p := range prefixes {
		out[i] = p.String()
	}
	return out
}
