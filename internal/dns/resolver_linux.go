package dns

import (
	"errors"
	"fmt"
	"os/exec"
)

// ConfigureOS points the system resolver at ResolverAddr on iface, for
// Domain and the reverse zones only. Domain is also a search domain, so short
// names like "laptop" resolve. It needs systemd-resolved; the settings go
// away with the interface. It returns a short description of how, for status.
func ConfigureOS(iface string, reverseZones []string) (string, error) {
	if _, err := exec.LookPath("resolvectl"); err != nil {
		return "", errors.New("split DNS needs systemd-resolved (resolvectl not found)")
	}
	if err := resolvectl("dns", iface, ResolverAddr.String()); err != nil {
		return "", err
	}
	// A plain domain is both a search and a routing domain; "~" ones only route.
	domains := []string{"domain", iface, Domain}
	for _, zone := range reverseZones {
		domains = append(domains, "~"+zone)
	}
	if err := resolvectl(domains...); err != nil {
		return "", err
	}
	// Never the default route, whatever resolved infers from the domains:
	// other names keep going where they went before.
	if err := resolvectl("default-route", iface, "false"); err != nil {
		return "", err
	}
	return "systemd-resolved", nil
}

// UnconfigureOS removes what ConfigureOS set up.
func UnconfigureOS(iface string) {
	if _, err := exec.LookPath("resolvectl"); err == nil {
		_ = resolvectl("revert", iface)
	}
}

func resolvectl(args ...string) error {
	if out, err := exec.Command("resolvectl", args...).CombinedOutput(); err != nil {
		return fmt.Errorf("resolvectl %v: %w: %s", args, err, out)
	}
	return nil
}
