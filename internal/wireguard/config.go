// Package wireguard runs an embedded userspace WireGuard device (wireguard-go)
// on a TUN interface and configures it from the control plane's network map.
package wireguard

import (
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"net/netip"
	"slices"
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

// PeersUAPI renders the changes that turn the peers in prev into next.
// Peers are updated in place, never re-created: re-creating one throws away
// its WireGuard session, so a new endpoint (relay to direct and back) would
// drop the tunnel until a new handshake. Empty when nothing changed.
func PeersUAPI(prev, next []Peer) (string, error) {
	old := map[string]Peer{}
	for _, p := range prev {
		old[p.PublicKey] = p
	}
	sorted := append([]Peer(nil), next...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].PublicKey < sorted[j].PublicKey })

	var b strings.Builder
	keep := map[string]bool{}
	for _, p := range sorted {
		key, err := KeyToHex(p.PublicKey)
		if err != nil {
			return "", err
		}
		keep[p.PublicKey] = true
		before, exists := old[p.PublicKey]
		endpoint := p.Endpoint != "" && (!exists || p.Endpoint != before.Endpoint)
		allowed := !exists || !slices.Equal(p.AllowedIPs, before.AllowedIPs)
		if !endpoint && !allowed && exists {
			continue
		}
		fmt.Fprintf(&b, "public_key=%s\n", key)
		if endpoint {
			fmt.Fprintf(&b, "endpoint=%s\n", p.Endpoint)
		}
		if !exists {
			fmt.Fprintf(&b, "persistent_keepalive_interval=%d\n", PersistentKeepalive)
		}
		if allowed {
			b.WriteString("replace_allowed_ips=true\n")
			for _, ip := range p.AllowedIPs {
				fmt.Fprintf(&b, "allowed_ip=%s\n", ip)
			}
		}
	}
	gone := []string{}
	for k := range old {
		if !keep[k] {
			gone = append(gone, k)
		}
	}
	sort.Strings(gone)
	for _, k := range gone {
		key, err := KeyToHex(k)
		if err != nil {
			continue // never added
		}
		fmt.Fprintf(&b, "public_key=%s\nremove=true\n", key)
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
