package wireguard

import (
	"fmt"
	"net/netip"
)

func routeAdd(iface string, p netip.Prefix) error {
	flag := "-inet"
	if p.Addr().Is6() {
		flag = "-inet6"
	}
	if err := run("route", "-q", "-n", "add", flag, p.String(), "-interface", iface); err != nil {
		return fmt.Errorf("route %s: %w", p, err)
	}
	return nil
}

func routeDel(iface string, p netip.Prefix) error {
	flag := "-inet"
	if p.Addr().Is6() {
		flag = "-inet6"
	}
	return run("route", "-q", "-n", "delete", flag, p.String(), "-interface", iface)
}

func forwardingOn(string, []netip.Prefix, []netip.Prefix, []netip.Prefix, []netip.Prefix) error {
	return fmt.Errorf("routing subnets is not supported on macOS yet: advertise them from a Linux device")
}

func forwardingOff(string, []netip.Prefix, []netip.Prefix) error { return nil }

func exitOn(string) error {
	return fmt.Errorf("exit nodes need a Linux client for now: macOS has no way yet to keep the agent's own traffic off the tunnel")
}
func exitOff(string) error { return nil }
func markConfig() string   { return "" }
