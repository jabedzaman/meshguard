package cli

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/spf13/cobra"

	"github.com/jabedzaman/meshguard/internal/ipc"
)

func newSet(o *options) *cobra.Command {
	var advertise []string
	var accept, advertiseExit bool
	var exitNode string
	cmd := &cobra.Command{
		Use:   "set",
		Short: "Change this device's settings",
		Long: `Change this device's settings. Only the flags you give change; the rest stay.

  meshguard set --advertise-routes 192.168.1.0/24    offer to route a subnet
  meshguard set --advertise-routes ""                stop offering routes
  meshguard set --accept-routes                      use subnets other devices route
  meshguard set --accept-routes=false
  meshguard set --advertise-exit-node                offer this device as an exit node
  meshguard set --exit-node laptop                   send all internet traffic through laptop
  meshguard set --exit-node ""                       stop using an exit node

Advertised routes and exit nodes take effect once an owner or admin approves them
in the web. Exit nodes work from and through Linux devices only.`,
		Args: cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			var req ipc.PrefsUpdate
			if cmd.Flags().Changed("advertise-routes") {
				routes := splitRoutes(advertise)
				req.AdvertiseRoutes = &routes
			}
			if cmd.Flags().Changed("accept-routes") {
				req.AcceptRoutes = &accept
			}
			if cmd.Flags().Changed("advertise-exit-node") {
				req.AdvertiseExitNode = &advertiseExit
			}
			if cmd.Flags().Changed("exit-node") {
				req.ExitNode = &exitNode
			}
			if req.AdvertiseRoutes == nil && req.AcceptRoutes == nil && req.AdvertiseExitNode == nil && req.ExitNode == nil {
				return cmd.Help()
			}
			var prefs ipc.Prefs
			if err := o.call(http.MethodPatch, "/v1/prefs", req, &prefs); err != nil {
				return err
			}
			if o.json {
				return printJSON(prefs)
			}
			printPrefs(prefs)
			return nil
		},
	}
	cmd.Flags().StringSliceVar(&advertise, "advertise-routes", nil, "subnets to offer to route, comma separated (empty to stop)")
	cmd.Flags().BoolVar(&accept, "accept-routes", false, "send traffic for other devices' approved subnets to them")
	cmd.Flags().BoolVar(&advertiseExit, "advertise-exit-node", false, "offer this device as an exit node for its peers")
	cmd.Flags().StringVar(&exitNode, "exit-node", "", "device to send all internet traffic through (name or mesh address; empty to stop)")
	cmd.Flags().BoolVar(&o.json, "json", false, "print JSON")
	return cmd
}

// splitRoutes drops the empty entries `--advertise-routes ""` produces.
func splitRoutes(in []string) []string {
	out := []string{}
	for _, r := range in {
		if r = strings.TrimSpace(r); r != "" {
			out = append(out, r)
		}
	}
	return out
}

func printPrefs(p ipc.Prefs) {
	routes := "none"
	if len(p.AdvertiseRoutes) > 0 {
		routes = strings.Join(p.AdvertiseRoutes, ", ")
	}
	fmt.Printf("  advertise-routes  %s\n  accept-routes     %v\n", routes, p.AcceptRoutes)
	if p.AdvertiseExitNode {
		fmt.Println("  exit node         offered to peers")
	}
	if p.ExitNode != "" {
		fmt.Printf("  exit-node         %s\n", p.ExitNode)
	}
}
