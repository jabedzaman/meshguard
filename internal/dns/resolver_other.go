//go:build !linux && !darwin

package dns

import "errors"

// ConfigureOS is not supported on this platform yet.
func ConfigureOS(string, []string) (string, error) {
	return "", errors.New("split DNS is not supported on this platform")
}

// UnconfigureOS does nothing on this platform.
func UnconfigureOS(string) {}
