package cli

import (
	"bufio"
	"bytes"
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"net/netip"
	"os/exec"
	"slices"
	"strconv"
	"strings"
)

// Parsers for the OS tools the doctor's probes run. They live here, not in
// the per-OS files, so every platform's parser is tested everywhere.

func execOutput(ctx context.Context, name string, args ...string) ([]byte, error) {
	out, err := exec.CommandContext(ctx, name, args...).CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("%s: %w: %s", name, err, bytes.TrimSpace(out))
	}
	return out, nil
}

func execQuiet(ctx context.Context, name string, args ...string) error {
	return exec.CommandContext(ctx, name, args...).Run()
}

// parseIPRouteGet reads the device from `ip route get <ip>` (Linux):
// "10.77.0.3 dev meshguard0 src 10.77.0.2 uid 1000".
func parseIPRouteGet(out []byte) (string, error) {
	fields := strings.Fields(string(out))
	if i := slices.Index(fields, "dev"); i >= 0 && i+1 < len(fields) {
		return fields[i+1], nil
	}
	return "", errors.New("no device in ip route output")
}

// parseRouteGet reads the interface from `route -n get <ip>` (macOS).
func parseRouteGet(out []byte) (string, error) {
	sc := bufio.NewScanner(bytes.NewReader(out))
	for sc.Scan() {
		if v, ok := strings.CutPrefix(strings.TrimSpace(sc.Text()), "interface:"); ok {
			return strings.TrimSpace(v), nil
		}
	}
	return "", errors.New("no interface in route output")
}

// parseProcNetTCP returns the addresses listening on port from
// /proc/net/tcp or /proc/net/tcp6 (Linux). Addresses are hex in host
// (little-endian) order, 32 bits at a time.
func parseProcNetTCP(data []byte, port int) []netip.Addr {
	var addrs []netip.Addr
	sc := bufio.NewScanner(bytes.NewReader(data))
	for sc.Scan() {
		f := strings.Fields(sc.Text())
		if len(f) < 4 || f[3] != "0A" { // 0A: LISTEN
			continue
		}
		host, portHex, ok := strings.Cut(f[1], ":")
		if !ok {
			continue
		}
		if p, err := strconv.ParseUint(portHex, 16, 16); err != nil || int(p) != port {
			continue
		}
		raw, err := hex.DecodeString(host)
		if err != nil || (len(raw) != 4 && len(raw) != 16) {
			continue
		}
		for i := 0; i < len(raw); i += 4 {
			slices.Reverse(raw[i : i+4])
		}
		if addr, ok := netip.AddrFromSlice(raw); ok {
			addrs = appendAddr(addrs, addr.Unmap())
		}
	}
	return addrs
}

// parseNetstat returns the addresses listening on port from
// `netstat -an -p tcp` (macOS): "tcp4  0  0  127.0.0.1.8080  *.*  LISTEN".
func parseNetstat(out []byte, port int) []netip.Addr {
	var addrs []netip.Addr
	suffix := "." + strconv.Itoa(port)
	sc := bufio.NewScanner(bytes.NewReader(out))
	for sc.Scan() {
		f := strings.Fields(sc.Text())
		if len(f) < 6 || f[len(f)-1] != "LISTEN" || !strings.HasPrefix(f[0], "tcp") {
			continue
		}
		host, ok := strings.CutSuffix(f[3], suffix)
		if !ok {
			continue
		}
		if host == "*" {
			if f[0] == "tcp6" {
				addrs = appendAddr(addrs, netip.IPv6Unspecified())
			} else {
				addrs = appendAddr(addrs, netip.IPv4Unspecified())
			}
			continue
		}
		host, _, _ = strings.Cut(host, "%") // fe80::1%lo0
		if addr, err := netip.ParseAddr(host); err == nil {
			addrs = appendAddr(addrs, addr)
		}
	}
	return addrs
}

// parseDscacheutil reads the addresses from `dscacheutil -q host -a name <name>` (macOS).
func parseDscacheutil(out []byte) []string {
	var addrs []string
	sc := bufio.NewScanner(bytes.NewReader(out))
	for sc.Scan() {
		k, v, ok := strings.Cut(sc.Text(), ":")
		if ok && (k == "ip_address" || k == "ipv6_address") {
			addrs = append(addrs, strings.TrimSpace(v))
		}
	}
	return addrs
}

func appendAddr(addrs []netip.Addr, a netip.Addr) []netip.Addr {
	if slices.Contains(addrs, a) {
		return addrs
	}
	return append(addrs, a)
}

// parseResolvConf returns the nameserver lines of resolv.conf.
func parseResolvConf(data []byte) []string {
	var servers []string
	sc := bufio.NewScanner(bytes.NewReader(data))
	for sc.Scan() {
		if f := strings.Fields(sc.Text()); len(f) >= 2 && f[0] == "nameserver" {
			servers = append(servers, f[1])
		}
	}
	return servers
}
