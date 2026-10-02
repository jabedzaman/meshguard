package cli

import (
	"fmt"
	"os"
	"strings"
	"text/tabwriter"
	"time"

	"github.com/spf13/cobra"

	"github.com/jabedzaman/meshguard/internal/ipc"
)

func newStatus(o *options) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "status",
		Short: "Show this machine's meshguard status and peers",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			s, err := o.status()
			if err != nil {
				return err
			}
			if o.json {
				return printJSON(s)
			}
			printStatus(s)
			return nil
		},
	}
	cmd.Flags().BoolVar(&o.json, "json", false, "print JSON")
	return cmd
}

func printStatus(s ipc.Status) {
	switch s.State {
	case "not_enrolled":
		fmt.Println("Not in a network. Run: meshguard up --token <token>")
		return
	case "down":
		fmt.Printf("%s in %s (down)\n", s.Device.Name, s.Network.Name)
		fmt.Printf("  mesh IPv4  %s\n  mesh IPv6  %s\n\nRun meshguard up to reconnect.\n", s.Device.MeshIPv4, s.Device.MeshIPv6)
		return
	}
	fmt.Printf("%s in %s (%s)\n", s.Device.Name, s.Network.Name, s.State)
	fmt.Printf("  mesh IPv4  %s\n  mesh IPv6  %s\n  server     %s\n", s.Device.MeshIPv4, s.Device.MeshIPv6, s.Server)
	if s.Interface != "" {
		fmt.Printf("  interface  %s\n", s.Interface)
	}
	if s.PublicEndpoint != "" {
		fmt.Printf("  public     %s\n", s.PublicEndpoint)
	}
	if s.DNS != nil {
		printDNS(*s.DNS)
	}
	if s.ACL != nil {
		printACL(*s.ACL)
	}
	if s.Relay != nil {
		state := "connecting"
		if s.Relay.Connected {
			state = "connected"
		}
		fmt.Printf("  relay      %s (%s)\n", s.Relay.URL, state)
	}
	if s.Problem != "" {
		fmt.Printf("\n  ! %s\n", s.Problem)
	}
	if len(s.Peers) > 0 {
		fmt.Println("\npeers:")
		printPeers(s.Peers, "  ")
	}
}

func printACL(a ipc.ACLStatus) {
	if a.DefaultAction == "allow" {
		fmt.Println("  access     every peer may connect")
		return
	}
	rules := "rules"
	if a.Rules == 1 {
		rules = "rule"
	}
	fmt.Printf("  access     only by %d %s (%d packets refused)\n", a.Rules, rules, a.Dropped)
}

func printDNS(d ipc.DNSStatus) {
	switch {
	case d.Configured != "":
		fmt.Printf("  dns        %s (resolver %s, via %s)\n", d.Name, d.Resolver, d.Configured)
	case d.Resolver != "":
		fmt.Printf("  dns        %s (resolver %s, not set up in the OS)\n", d.Name, d.Resolver)
	default:
		fmt.Printf("  dns        %s (off)\n", d.Name)
	}
	if d.Problem != "" {
		fmt.Printf("             ! %s\n", d.Problem)
	}
}

func newPeers(o *options) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "peers",
		Short: "List peers, how each is reached, and the last handshake",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			s, err := o.status()
			if err != nil {
				return err
			}
			if o.json {
				if s.Peers == nil {
					s.Peers = []ipc.Peer{}
				}
				return printJSON(s.Peers)
			}
			if len(s.Peers) == 0 {
				fmt.Println("No peers yet.")
				return nil
			}
			printPeers(s.Peers, "")
			return nil
		},
	}
	cmd.Flags().BoolVar(&o.json, "json", false, "print JSON")
	return cmd
}

func printPeers(peers []ipc.Peer, indent string) {
	tw := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
	fmt.Fprintf(tw, "%sNAME\tDNS\tIPv4\tPATH\tHANDSHAKE\n", indent)
	for _, p := range peers {
		fmt.Fprintf(tw, "%s%s\t%s\t%s\t%s\t%s\n", indent, p.Name, p.DNSName, p.MeshIPv4, path(p), handshake(p))
	}
	tw.Flush()
}

func path(p ipc.Peer) string {
	switch {
	case p.ViaRelay:
		return "relay"
	case p.Endpoint != "" && !strings.HasPrefix(p.Endpoint, "relay/"):
		return "direct " + p.Endpoint
	default:
		return "-"
	}
}

func handshake(p ipc.Peer) string {
	if p.LastHandshake == nil {
		return "never"
	}
	return time.Since(*p.LastHandshake).Round(time.Second).String() + " ago"
}
