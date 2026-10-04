package cli

import (
	"context"
	"errors"
	"net"
	"net/netip"
	"os"
	"time"
)

func routeInterface(ip string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	out, err := execOutput(ctx, "ip", "route", "get", ip)
	if err != nil {
		return "", err
	}
	return parseIPRouteGet(out)
}

func tcpListeners(port int) ([]netip.Addr, error) {
	var addrs []netip.Addr
	var errs []error
	for _, file := range []string{"/proc/net/tcp", "/proc/net/tcp6"} {
		data, err := os.ReadFile(file)
		if err != nil {
			errs = append(errs, err)
			continue
		}
		for _, a := range parseProcNetTCP(data, port) {
			addrs = appendAddr(addrs, a)
		}
	}
	if len(errs) == 2 {
		return nil, errors.Join(errs...)
	}
	return addrs, nil
}

// resolveHost uses Go's resolver, which follows /etc/nsswitch.conf and
// /etc/resolv.conf (systemd-resolved's stub) like other programs.
func resolveHost(name string) ([]string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	return net.DefaultResolver.LookupHost(ctx, name)
}

// resolvConfNameservers lists the nameservers programs use.
func resolvConfNameservers() []string {
	data, err := os.ReadFile("/etc/resolv.conf")
	if err != nil {
		return nil
	}
	return parseResolvConf(data)
}
