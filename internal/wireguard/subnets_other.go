//go:build !linux && !darwin

package wireguard

import (
	"fmt"
	"net/netip"
	"runtime"
)

func routeAdd(string, netip.Prefix) error {
	return fmt.Errorf("subnet routes are not supported on %s yet", runtime.GOOS)
}
func routeDel(string, netip.Prefix) error { return nil }
func forwardingOn(string, []netip.Prefix, []netip.Prefix, []netip.Prefix, []netip.Prefix) error {
	return fmt.Errorf("routing subnets is not supported on %s yet", runtime.GOOS)
}
func forwardingOff(string, []netip.Prefix, []netip.Prefix) error { return nil }
