//go:build !linux && !darwin

package cli

import (
	"context"
	"fmt"
	"net"
	"net/netip"
	"runtime"
	"time"
)

func routeInterface(string) (string, error) {
	return "", fmt.Errorf("not supported on %s yet", runtime.GOOS)
}

func tcpListeners(int) ([]netip.Addr, error) {
	return nil, fmt.Errorf("not supported on %s yet", runtime.GOOS)
}

func resolveHost(name string) ([]string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	return net.DefaultResolver.LookupHost(ctx, name)
}

func resolvConfNameservers() []string { return nil }
