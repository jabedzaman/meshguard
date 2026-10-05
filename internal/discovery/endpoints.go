// Package discovery works out where peers can reach this device. For now that
// is its local interface addresses (same LAN or public IP); STUN-observed
// addresses and NAT traversal come later.
package discovery

import (
	"net"
	"net/netip"
	"strconv"
)

// usable reports whether an interface can carry or identify a direct path to a
// peer. Point-to-point interfaces are VPN tunnels (Tailscale, other WireGuard,
// OpenVPN, our own mesh interface): not shared networks, and routing our
// WireGuard through them would nest tunnels.
func usable(flags net.Flags, name, skipInterface string) bool {
	return flags&net.FlagUp != 0 &&
		flags&net.FlagLoopback == 0 &&
		flags&net.FlagPointToPoint == 0 &&
		name != skipInterface
}

// Endpoints returns "ip:port" candidates for the WireGuard listen port, IPv4
// first. Addresses inside any of exclude (the mesh ranges) are skipped, as are
// loopback, link-local, point-to-point (VPN) interfaces and skipInterface.
func Endpoints(port int, skipInterface string, exclude []netip.Prefix) []string {
	ifaces, err := net.Interfaces()
	if err != nil {
		return nil
	}
	var addrs []netip.Addr
	for _, iface := range ifaces {
		if !usable(iface.Flags, iface.Name, skipInterface) {
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
