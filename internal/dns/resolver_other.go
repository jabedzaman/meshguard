//go:build !linux && !darwin

package dns

import (
	"errors"
	"net/netip"
)

// ListenAddr is where the agent serves DNS: its mesh address.
func ListenAddr(meshIPv4 netip.Addr) netip.AddrPort {
	return netip.AddrPortFrom(meshIPv4, 53)
}

// ConfigureOS is not supported on this platform yet.
func ConfigureOS(string, netip.AddrPort) (string, error) {
	return "", errors.New("split DNS is not supported on this platform")
}

// UnconfigureOS does nothing on this platform.
func UnconfigureOS(string) {}
