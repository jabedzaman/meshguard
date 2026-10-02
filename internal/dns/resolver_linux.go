package dns

import (
	"errors"
	"fmt"
	"net/netip"
	"os/exec"
)

// ListenAddr is where the agent serves DNS: its mesh address, which
// systemd-resolved reaches like any per-link DNS server.
func ListenAddr(meshIPv4 netip.Addr) netip.AddrPort {
	return netip.AddrPortFrom(meshIPv4, 53)
}

// ConfigureOS points the system resolver at server for Domain on iface. It
// needs systemd-resolved; the settings go away with the interface. It returns
// a short description of how, for status.
func ConfigureOS(iface string, server netip.AddrPort) (string, error) {
	if _, err := exec.LookPath("resolvectl"); err != nil {
		return "", errors.New("split DNS needs systemd-resolved (resolvectl not found)")
	}
	if err := resolvectl("dns", iface, server.Addr().String()); err != nil {
		return "", err
	}
	if err := resolvectl("domain", iface, "~"+Domain); err != nil {
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
