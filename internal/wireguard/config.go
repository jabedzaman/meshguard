// Package wireguard runs an embedded userspace WireGuard device (wireguard-go)
// on a TUN interface and configures it from the control plane's network map.
package wireguard

import (
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"net/netip"
	"sort"
	"strings"
)

// PersistentKeepalive keeps NAT mappings open and lets peers see each other as
// alive. 25s is WireGuard's recommended value.
const PersistentKeepalive = 25

// Peer is one WireGuard peer.
type Peer struct {
	// Base64 Curve25519 public key, as the control plane stores it.
	PublicKey string
	// "host:port" to send to; empty if unknown (the peer can still reach us).
	Endpoint   string
	AllowedIPs []netip.Prefix
}

// KeyToHex converts a base64 WireGuard key to the hex form the UAPI expects.
func KeyToHex(key string) (string, error) {
	raw, err := base64.StdEncoding.DecodeString(key)
	if err != nil || len(raw) != 32 {
		return "", fmt.Errorf("invalid wireguard key %q", key)
	}
	return hex.EncodeToString(raw), nil
}

// PeersUAPI renders a configuration that replaces all peers with these.
// Output is deterministic so callers can skip re-applying an unchanged map.
func PeersUAPI(peers []Peer) (string, error) {
	sorted := append([]Peer(nil), peers...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].PublicKey < sorted[j].PublicKey })

	var b strings.Builder
	b.WriteString("replace_peers=true\n")
	for _, p := range sorted {
		key, err := KeyToHex(p.PublicKey)
		if err != nil {
			return "", err
		}
		fmt.Fprintf(&b, "public_key=%s\n", key)
		if p.Endpoint != "" {
			fmt.Fprintf(&b, "endpoint=%s\n", p.Endpoint)
		}
		fmt.Fprintf(&b, "persistent_keepalive_interval=%d\n", PersistentKeepalive)
		b.WriteString("replace_allowed_ips=true\n")
		for _, ip := range p.AllowedIPs {
			fmt.Fprintf(&b, "allowed_ip=%s\n", ip)
		}
	}
	return b.String(), nil
}

// HostPrefix turns a single address ("10.77.1.2") into a host route (/32 or /128).
func HostPrefix(addr string) (netip.Prefix, error) {
	ip, err := netip.ParseAddr(addr)
	if err != nil {
		return netip.Prefix{}, err
	}
	return netip.PrefixFrom(ip, ip.BitLen()), nil
}
