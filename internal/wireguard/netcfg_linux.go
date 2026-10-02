package wireguard

import (
	"fmt"
	"net/netip"
	"os/exec"
)

// configureInterface assigns addresses (with the network's prefix length, which
// also installs the route for the whole network) and brings the link up.
func configureInterface(name string, addresses []netip.Prefix) error {
	for _, addr := range addresses {
		family := "-4"
		if addr.Addr().Is6() {
			family = "-6"
		}
		if err := run("ip", family, "addr", "replace", addr.String(), "dev", name); err != nil {
			return err
		}
	}
	return run("ip", "link", "set", "dev", name, "mtu", fmt.Sprint(MTU), "up")
}

func run(name string, args ...string) error {
	if out, err := exec.Command(name, args...).CombinedOutput(); err != nil {
		return fmt.Errorf("%s %v: %w: %s", name, args, err, out)
	}
	return nil
}
