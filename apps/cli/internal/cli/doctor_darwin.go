package cli

import (
	"context"
	"errors"
	"net/netip"
	"time"
)

func routeInterface(ip string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	out, err := execOutput(ctx, "route", "-n", "get", ip)
	if err != nil {
		return "", err
	}
	return parseRouteGet(out)
}

func tcpListeners(port int) ([]netip.Addr, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	out, err := execOutput(ctx, "netstat", "-an", "-p", "tcp")
	if err != nil {
		return nil, err
	}
	return parseNetstat(out, port), nil
}

// resolveHost asks Directory Services, which honors /etc/resolver like
// other programs do (Go's own resolver may not).
func resolveHost(name string) ([]string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	out, err := execOutput(ctx, "dscacheutil", "-q", "host", "-a", "name", name)
	if err != nil {
		return nil, err
	}
	addrs := parseDscacheutil(out)
	if len(addrs) == 0 {
		return nil, errors.New("no such host")
	}
	return addrs, nil
}

func resolvConfNameservers() []string { return nil }
