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
	if s.Prefs != nil && (len(s.Prefs.AdvertiseRoutes) > 0 || s.Prefs.AcceptRoutes || s.Prefs.AdvertiseExitNode || s.Prefs.ExitNode != "") {
		printPrefs(*s.Prefs)
	}
	if s.Funnel != nil {
		if s.Funnel.State == "live" {
			fmt.Printf("  funnel     live at https://%s (port %d)\n", s.Funnel.Name, s.Funnel.Port)
		} else {
			fmt.Printf("  funnel     port %d: %s\n", s.Funnel.Port, s.Funnel.State)
		}
	}
	if len(s.Serve) > 0 {
		fmt.Printf("  sharing    %d local port(s): meshguard serve\n", len(s.Serve))
	}
	if subnets := withoutDefaultRoutes(s.Serving); len(subnets) > 0 {
		fmt.Printf("  serving    %s (routed for peers)\n", strings.Join(subnets, ", "))
	}
	if s.ServingExitNode {
		fmt.Println("  serving    all internet traffic (exit node)")
	}
	if s.ExitNode != "" {
		fmt.Printf("  exit node  all internet traffic goes through %s\n", s.ExitNode)
	}
	if len(s.Accepted) > 0 {
		fmt.Printf("  accepting  %s (through peers)\n", strings.Join(s.Accepted, ", "))
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
	if len(s.Connectors) > 0 {
		fmt.Println("\napp connectors:")
		w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
		fmt.Fprintln(w, "  NAME\tDOMAINS\tTHROUGH")
		for _, cn := range s.Connectors {
			through := cn.Host
			switch {
			case cn.Hosting:
				through = "this device"
			case through == "":
				through = "no host online"
			case cn.Routes > 0:
				through = fmt.Sprintf("%s (%d addresses routed)", cn.Host, cn.Routes)
			}
			fmt.Fprintf(w, "  %s\t%s\t%s\n", cn.Name, strings.Join(cn.Domains, ", "), through)
		}
		w.Flush()
	}
	if len(s.Services) > 0 {
		fmt.Println("\nservices:")
		printServices(s.Services)
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
	case p.Endpoint != "" && !strings.HasPrefix(p.Endpoint, "peer/"):
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

func withoutDefaultRoutes(routes []string) []string {
	var out []string
	for _, r := range routes {
		if r != "0.0.0.0/0" && r != "::/0" {
			out = append(out, r)
		}
	}
	return out
}
