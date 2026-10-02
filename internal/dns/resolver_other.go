//go:build !linux && !darwin

package dns

import (
	"errors"
	"net/netip"
)

// ConfigureOS is not supported on this platform yet.
func ConfigureOS(string, netip.Addr) (string, error) {
	return "", errors.New("split DNS is not supported on this platform")
}

// UnconfigureOS does nothing on this platform.
func UnconfigureOS(string) {}
