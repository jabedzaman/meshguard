package cli

import (
	"errors"
	"fmt"
	"net/http"
	"net/netip"
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"strings"

	"github.com/spf13/cobra"

	"github.com/twinlabshq/mesh/internal/dns"
	"github.com/twinlabshq/mesh/internal/ipc"
)

// findPeer resolves a peer by name (case-insensitive, unique prefix, with or
// without ".internal") or mesh IP.
func findPeer(peers []ipc.Peer, query string) (ipc.Peer, error) {
	q := strings.TrimSuffix(strings.TrimSuffix(strings.ToLower(query), "."), "."+dns.Domain)
	var matches []ipc.Peer
	for _, p := range peers {
		name := strings.ToLower(p.Name)
		switch {
		case name == q || p.MeshIPv4 == query || p.MeshIPv6 == query:
			return p, nil
		case strings.HasPrefix(name, q):
			matches = append(matches, p)
		}
	}
	switch len(matches) {
	case 1:
		return matches[0], nil
	case 0:
		return ipc.Peer{}, fmt.Errorf("no peer named %q (see mesh peers)", query)
	default:
		names := make([]string, len(matches))
		for i, m := range matches {
			names[i] = m.Name
		}
		return ipc.Peer{}, fmt.Errorf("%q matches several peers: %s", query, strings.Join(names, ", "))
	}
}

func newIP(o *options) *cobra.Command {
	var v6 bool
	cmd := &cobra.Command{
		Use:   "ip [peer]",
		Short: "Print this machine's mesh IP, or a peer's",
		Example: `  mesh ip              # this machine's IPv4
  mesh ip -6           # this machine's IPv6
  mesh ip macbook      # a peer's IPv4`,
		Args: cobra.MaximumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			s, err := o.status()
			if err != nil {
				return err
			}
			if s.Device == nil {
				return errors.New("not in a network")
			}
			v4, v6addr := s.Device.MeshIPv4, s.Device.MeshIPv6
			if len(args) == 1 {
				p, err := findPeer(s.Peers, args[0])
				if err != nil {
					return err
				}
				v4, v6addr = p.MeshIPv4, p.MeshIPv6
			}
			if v6 {
				fmt.Println(v6addr)
			} else {
				fmt.Println(v4)
			}
			return nil
		},
	}
	cmd.Flags().BoolVarP(&v6, "ipv6", "6", false, "print the IPv6 address")
	return cmd
}

func newPing(o *options) *cobra.Command {
	var count int
	var v6 bool
	cmd := &cobra.Command{
		Use:   "ping <peer>",
		Short: "Ping a peer over the mesh by name",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			s, err := o.status()
			if err != nil {
				return err
			}
			p, err := findPeer(s.Peers, args[0])
			if err != nil {
				return err
			}
			target := p.MeshIPv4
			if v6 {
				target = p.MeshIPv6
			}
			fmt.Printf("pinging %s (%s) via %s\n", p.Name, target, path(p))
			bin := "ping"
			if addr, err := netip.ParseAddr(target); err == nil && addr.Is6() && runtime.GOOS == "darwin" {
				bin = "ping6"
			}
			ping := exec.Command(bin, "-c", strconv.Itoa(count), target)
			ping.Stdout, ping.Stderr = os.Stdout, os.Stderr
			return ping.Run()
		},
	}
	cmd.Flags().IntVarP(&count, "count", "c", 4, "number of pings")
	cmd.Flags().BoolVarP(&v6, "ipv6", "6", false, "ping the peer's IPv6 address")
	return cmd
}

func newNetcheck(o *options) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "netcheck",
		Short: "Check this machine's NAT, public address and relay",
		Long: `Asks each STUN server for this machine's public address (from the WireGuard
socket) and reports the NAT type: endpoint-independent NATs allow direct
connections; symmetric NATs need the relay.`,
		Args: cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			var nc ipc.Netcheck
			if err := o.call(http.MethodGet, "/v1/netcheck", nil, &nc); err != nil {
				return err
			}
			if o.json {
				return printJSON(nc)
			}
			printNetcheck(nc)
			return nil
		},
	}
	cmd.Flags().BoolVar(&o.json, "json", false, "print JSON")
	return cmd
}

var natAdvice = map[string]string{
	"endpoint-independent": "direct connections can work",
	"symmetric":            "direct connections are unlikely; peers will use the relay",
	"unknown":              "needs answers from 2+ STUN servers to tell",
}

func printNetcheck(nc ipc.Netcheck) {
	fmt.Println("STUN:")
	if len(nc.Stun) == 0 {
		fmt.Println("  no STUN servers configured on the control plane (STUN_SERVERS)")
	}
	for _, r := range nc.Stun {
		if r.Error != "" {
			fmt.Printf("  %-32s %s\n", r.Server, r.Error)
		} else {
			fmt.Printf("  %-32s public %-22s %dms\n", r.Server, r.Public, r.LatencyMs)
		}
	}
	fmt.Printf("\nNAT:    %s (%s)\n", nc.NAT, natAdvice[nc.NAT])
	if nc.Relay != nil {
		state := "not connected"
		if nc.Relay.Connected {
			state = "connected"
		}
		fmt.Printf("relay:  %s (%s)\n", nc.Relay.URL, state)
	} else {
		fmt.Println("relay:  none configured")
	}
	if len(nc.Endpoints) > 0 {
		fmt.Printf("advertised endpoints:\n  %s\n", strings.Join(nc.Endpoints, "\n  "))
	}
}

func newVersion(o *options) *cobra.Command {
	return &cobra.Command{
		Use:   "version",
		Short: "Print the CLI and agent versions",
		Args:  cobra.NoArgs,
		Run: func(cmd *cobra.Command, _ []string) {
			fmt.Printf("mesh   %s\n", Version)
			if s, err := o.status(); err == nil {
				fmt.Printf("agent  %s\n", s.Version)
			} else {
				fmt.Println("agent  not reachable")
			}
		},
	}
}
