// Package discovery works out where peers can reach this device. For now that
// is its local interface addresses (same LAN or public IP); STUN-observed
// addresses and NAT traversal come later.
package discovery

import (
	"net"
	"net/netip"
	"strconv"
)

// Endpoints returns "ip:port" candidates for the WireGuard listen port, IPv4
// first. Addresses inside any of exclude (the mesh ranges) are skipped, as are
// loopback, link-local and the interface named skipInterface (our TUN).
func Endpoints(port int, skipInterface string, exclude []netip.Prefix) []string {
	ifaces, err := net.Interfaces()
	if err != nil {
		return nil
	}
	var addrs []netip.Addr
	for _, iface := range ifaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 || iface.Name == skipInterface {
			continue
		}
		ifAddrs, err := iface.Addrs()
		if err != nil {
			continue
		}
		for _, a := range ifAddrs {
			if prefix, err := netip.ParsePrefix(a.String()); err == nil {
				addrs = append(addrs, prefix.Addr())
			}
		}
	}
	return Filter(addrs, port, exclude)
}

// Filter keeps usable unicast addresses and formats them as endpoints.
func Filter(addrs []netip.Addr, port int, exclude []netip.Prefix) []string {
	var v4, v6 []string
	p := strconv.Itoa(port)
	for _, addr := range addrs {
		addr = addr.Unmap()
		if !addr.IsGlobalUnicast() && !addr.IsPrivate() || addr.IsLinkLocalUnicast() {
			continue
		}
		excluded := false
		for _, prefix := range exclude {
			if prefix.Contains(addr) {
				excluded = true
				break
			}
		}
		if excluded {
			continue
		}
		if addr.Is4() {
			v4 = append(v4, net.JoinHostPort(addr.String(), p))
		} else {
			v6 = append(v6, net.JoinHostPort(addr.String(), p))
		}
	}
	return append(v4, v6...)
}

// LocalPrefixes returns the networks this machine is directly attached to
// (interface addresses with their masks), skipping loopback and skipInterface.
// A peer endpoint inside one of these is reachable without NAT.
func LocalPrefixes(skipInterface string) []netip.Prefix {
	ifaces, err := net.Interfaces()
	if err != nil {
		return nil
	}
	var prefixes []netip.Prefix
	for _, iface := range ifaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 || iface.Name == skipInterface {
			continue
		}
		addrs, err := iface.Addrs()
		if err != nil {
			continue
		}
		for _, a := range addrs {
			if p, err := netip.ParsePrefix(a.String()); err == nil && !p.Addr().IsLinkLocalUnicast() {
				prefixes = append(prefixes, p.Masked())
			}
		}
	}
	return prefixes
}

// DirectEndpoint picks the first endpoint on a directly attached network, or
// "" if none is (the peer is behind NAT or elsewhere).
func DirectEndpoint(endpoints []string, local []netip.Prefix) string {
	for _, ep := range endpoints {
		addrPort, err := netip.ParseAddrPort(ep)
		if err != nil {
			continue
		}
		for _, p := range local {
			if p.Contains(addrPort.Addr().Unmap()) {
				return ep
			}
		}
	}
	return ""
}
