package wireguard

import (
	"fmt"
	"net/netip"
	"os/exec"
)

// configureInterface assigns each mesh address to the utun interface and
// routes the network's range and routes through it.
func configureInterface(name string, addresses, routes []netip.Prefix) error {
	for _, addr := range addresses {
		ip := addr.Addr().String()
		network := addr.Masked().String()
		if addr.Addr().Is4() {
			if err := run("ifconfig", name, "inet", ip, ip, "netmask", "255.255.255.255", "up"); err != nil {
				return err
			}
			if err := run("route", "-q", "-n", "add", "-inet", network, "-interface", name); err != nil {
				return err
			}
		} else {
			if err := run("ifconfig", name, "inet6", ip, "prefixlen", "128", "alias"); err != nil {
				return err
			}
			if err := run("route", "-q", "-n", "add", "-inet6", network, "-interface", name); err != nil {
				return err
			}
		}
	}
	for _, route := range routes {
		family := "-inet"
		if route.Addr().Is6() {
			family = "-inet6"
		}
		if err := run("route", "-q", "-n", "add", family, route.String(), "-interface", name); err != nil {
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
