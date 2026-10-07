package wireguard

import (
	"fmt"
	"net/netip"
	"os"
	"os/exec"
	"strings"

	"github.com/jabedzaman/meshguard/internal/netmark"
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
//
// A default route (an exit node) is masqueraded for everything that leaves by
// any interface but the mesh one.
func masqueradeRule(route, mesh netip.Prefix, iface string) (tool string, args []string) {
	tool = "iptables"
	if route.Addr().Is6() {
		tool = "ip6tables"
	}
	args = []string{"-t", "nat", "POSTROUTING", "-s", mesh.String()}
	if route.Bits() == 0 {
		args = append(args, "!", "-o", iface)
	} else {
		args = append(args, "-d", route.String())
	}
	return tool, append(args, "-j", "MASQUERADE")
}

func ruleOp(op string, route, mesh netip.Prefix, iface string) error {
	tool, args := masqueradeRule(route, mesh, iface)
	cmd := append([]string{args[0], args[1], op}, args[2:]...)
	return run(tool, cmd...)
}

func ruleExists(route, mesh netip.Prefix, iface string) bool {
	return ruleOp("-C", route, mesh, iface) == nil
}

func sameFamily(a, b netip.Prefix) bool { return a.Addr().Is4() == b.Addr().Is4() }

// enableForwarding turns on IP forwarding for the families of routes. Only
// the families in use are touched, and one that is already on is left alone:
// containers can't write /proc/sys but may have it set.
func enableForwarding(routes []netip.Prefix) error {
	var need4, need6 bool
	for _, p := range routes {
		need4 = need4 || p.Addr().Is4()
		need6 = need6 || p.Addr().Is6()
	}
	var firstErr error
	for _, f := range []struct {
		need bool
		path string
	}{
		{need4, "/proc/sys/net/ipv4/ip_forward"},
		{need6, "/proc/sys/net/ipv6/conf/all/forwarding"},
	} {
		if !f.need {
			continue
		}
		current, err := os.ReadFile(f.path)
		if err != nil || strings.TrimSpace(string(current)) == "1" {
			continue
		}
		if err := os.WriteFile(f.path, []byte("1"), 0o644); err != nil && firstErr == nil {
			name := strings.ReplaceAll(strings.TrimPrefix(f.path, "/proc/sys/"), "/", ".")
			firstErr = fmt.Errorf("enable forwarding (set %s=1 yourself): %w", name, err)
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
	var failed []string
	// A family whose forwarding can't be turned on doesn't stop the other one.
	if err := enableForwarding(routes); err != nil {
		failed = append(failed, err.Error())
	}
	for _, route := range routes {
		for _, m := range mesh {
			if !sameFamily(route, m) {
				continue
			}
			if ruleExists(route, m, iface) {
				continue
			}
			if err := ruleOp("-A", route, m, iface); err != nil {
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
func forwardingOff(iface string, routes, mesh []netip.Prefix) error {
	for _, route := range routes {
		for _, m := range mesh {
			if sameFamily(route, m) {
				for ruleExists(route, m, iface) {
					if err := ruleOp("-D", route, m, iface); err != nil {
						break
					}
				}
			}
		}
	}
	return nil
}

// Policy routing for an exit node, as wg-quick does it: everything that does
// not carry the agent's mark uses a table whose default route is the mesh
// interface, while routes in the main table other than the default (the local
// network, the mesh, accepted subnets) keep winning.
const (
	exitTable    = "51820" // netmark.Mark
	exitPrefOut  = "32765"
	exitPrefMain = "32764"
)

func exitOn(iface string) error {
	var failed []string
	for _, fam := range []string{"-4", "-6"} {
		steps := [][]string{
			{fam, "route", "replace", "default", "dev", iface, "table", exitTable},
		}
		for _, args := range steps {
			if err := run("ip", args...); err != nil {
				failed = append(failed, err.Error())
			}
		}
		exitRulesDel(fam)
		for _, args := range [][]string{
			{fam, "rule", "add", "not", "fwmark", exitTable, "table", exitTable, "pref", exitPrefOut},
			{fam, "rule", "add", "table", "main", "suppress_prefixlength", "0", "pref", exitPrefMain},
		} {
			if err := run("ip", args...); err != nil {
				failed = append(failed, err.Error())
			}
		}
	}
	// Replies to marked packets must pass the reverse path check.
	_ = os.WriteFile("/proc/sys/net/ipv4/conf/all/src_valid_mark", []byte("1"), 0o644)
	if len(failed) > 0 {
		return fmt.Errorf("%s", strings.Join(failed, "; "))
	}
	return nil
}

func exitRulesDel(fam string) {
	for _, args := range [][]string{
		{fam, "rule", "del", "not", "fwmark", exitTable, "table", exitTable, "pref", exitPrefOut},
		{fam, "rule", "del", "table", "main", "suppress_prefixlength", "0", "pref", exitPrefMain},
	} {
		for run("ip", args...) == nil {
		}
	}
}

func exitOff(string) error {
	for _, fam := range []string{"-4", "-6"} {
		exitRulesDel(fam)
		_ = run("ip", fam, "route", "flush", "table", exitTable)
	}
	return nil
}

// markConfig is the UAPI line that marks WireGuard's own sockets.
func markConfig() string { return fmt.Sprintf("fwmark=%d\n", netmark.Mark) }
