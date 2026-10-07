package wireguard

import (
	"fmt"
	"net/netip"
	"os"
	"os/exec"
	"strings"
)

func family(p netip.Prefix) string {
	if p.Addr().Is6() {
		return "-6"
	}
	return "-4"
}

func routeAdd(iface string, p netip.Prefix) error {
	if err := run("ip", family(p), "route", "replace", p.String(), "dev", iface); err != nil {
		return fmt.Errorf("route %s: %w", p, err)
	}
	return nil
}

func routeDel(iface string, p netip.Prefix) error {
	return run("ip", family(p), "route", "del", p.String(), "dev", iface)
}

// masqueradeRule is the NAT rules for one served route: traffic from the
// mesh to that subnet leaves with this device's address on the subnet's side.
func masqueradeRule(route, mesh netip.Prefix) (tool string, args []string) {
	tool = "iptables"
	if route.Addr().Is6() {
		tool = "ip6tables"
	}
	return tool, []string{"-t", "nat", "POSTROUTING", "-s", mesh.String(), "-d", route.String(), "-j", "MASQUERADE"}
}

func ruleOp(op string, route, mesh netip.Prefix) error {
	tool, args := masqueradeRule(route, mesh)
	cmd := append([]string{args[0], args[1], op}, args[2:]...)
	return run(tool, cmd...)
}

func ruleExists(route, mesh netip.Prefix) bool {
	return ruleOp("-C", route, mesh) == nil
}

func sameFamily(a, b netip.Prefix) bool { return a.Addr().Is4() == b.Addr().Is4() }

func setForwarding(on bool) error {
	v := "0"
	if on {
		v = "1"
	}
	var firstErr error
	for _, path := range []string{"/proc/sys/net/ipv4/ip_forward", "/proc/sys/net/ipv6/conf/all/forwarding"} {
		if _, err := os.Stat(path); err != nil {
			continue
		}
		if err := os.WriteFile(path, []byte(v), 0o644); err != nil && firstErr == nil {
			firstErr = fmt.Errorf("enable forwarding: %w", err)
		}
	}
	return firstErr
}

// forwardingOn turns on IP forwarding and installs the masquerade rules for
// routes, removing the ones for previous routes that are gone.
func forwardingOn(iface string, routes, mesh, oldRoutes, oldMesh []netip.Prefix) error {
	if _, err := exec.LookPath("iptables"); err != nil {
		return fmt.Errorf("subnet routing needs iptables on this machine")
	}
	forwardingOff(iface, oldRoutes, oldMesh)
	if err := setForwarding(true); err != nil {
		return err
	}
	var failed []string
	for _, route := range routes {
		for _, m := range mesh {
			if !sameFamily(route, m) {
				continue
			}
			if ruleExists(route, m) {
				continue
			}
			if err := ruleOp("-A", route, m); err != nil {
				failed = append(failed, err.Error())
			}
		}
	}
	if len(failed) > 0 {
		return fmt.Errorf("%s", strings.Join(failed, "; "))
	}
	return nil
}

// forwardingOff removes the masquerade rules. IP forwarding stays on: the
// machine may have needed it before meshguard.
func forwardingOff(_ string, routes, mesh []netip.Prefix) error {
	for _, route := range routes {
		for _, m := range mesh {
			if sameFamily(route, m) {
				for ruleExists(route, m) {
					if err := ruleOp("-D", route, m); err != nil {
						break
					}
				}
			}
		}
	}
	return nil
}
