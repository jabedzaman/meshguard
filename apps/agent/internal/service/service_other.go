//go:build !linux && !darwin

package service

import (
	"fmt"
	"runtime"
)

func install(Config) error {
	return fmt.Errorf("installing as a service isn't supported on %s yet", runtime.GOOS)
}
func uninstall() error {
	return fmt.Errorf("installing as a service isn't supported on %s yet", runtime.GOOS)
}

// Describe says where the service lives, for the CLI output.
func Describe() string { return "" }
