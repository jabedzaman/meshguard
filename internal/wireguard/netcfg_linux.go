package wireguard

import (
	"fmt"
	"net/netip"
	"os/exec"
)

// configureInterface assigns addresses (with the network's prefix length, which
// also installs the route for the whole network), brings the link up and adds
// routes.
func configureInterface(name string, addresses, routes []netip.Prefix) error {
	for _, addr := range addresses {
		family := "-4"
		if addr.Addr().Is6() {
			family = "-6"
		}
		if err := run("ip", family, "addr", "replace", addr.String(), "dev", name); err != nil {
			return err
		}
	}
	if err := run("ip", "link", "set", "dev", name, "mtu", fmt.Sprint(MTU), "up"); err != nil {
		return err
	}
	for _, route := range routes {
		if err := run("ip", "route", "replace", route.String(), "dev", name); err != nil {
			return err
		}
	}
	return nil
}

func run(name string, args ...string) error {
	if out, err := exec.Command(name, args...).CombinedOutput(); err != nil {
		return fmt.Errorf("%s %v: %w: %s", name, args, err, out)
	}
	return nil
}
