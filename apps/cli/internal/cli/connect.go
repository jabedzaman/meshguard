package cli

import (
	"fmt"
	"net/http"
	"os"

	"github.com/spf13/cobra"

	"github.com/jabedzaman/meshguard/internal/ipc"
)

func defaultServer() string {
	if s := os.Getenv("MESHGUARD_SERVER"); s != "" {
		return s
	}
	return "http://localhost:4000"
}

func newUp(o *options) *cobra.Command {
	var token, server string
	cmd := &cobra.Command{
		Use:   "up",
		Short: "Join a network with a token, or reconnect after meshguard down",
		Example: `  meshguard up --token meshguard_enr_...                   # join (token from the network's Add device)
  meshguard up --token meshguard_enr_... --server https://api.example.com
  meshguard up                                        # reconnect after meshguard down`,
		Args: cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			req := ipc.UpRequest{Token: token}
			if token != "" {
				req.Server = server
			}
			var s ipc.Status
			if err := o.call(http.MethodPost, "/v1/up", req, &s); err != nil {
				return err
			}
			if token != "" {
				fmt.Printf("Joined %s as %s\n", s.Network.Name, s.Device.Name)
			} else {
				fmt.Printf("Reconnecting %s in %s\n", s.Device.Name, s.Network.Name)
			}
			fmt.Printf("  mesh IPv4  %s\n  mesh IPv6  %s\n", s.Device.MeshIPv4, s.Device.MeshIPv6)
			return nil
		},
	}
	cmd.Flags().StringVar(&token, "token", "", "enrollment token (meshguard_enr_...)")
	cmd.Flags().StringVar(&server, "server", defaultServer(), "control plane URL ($MESHGUARD_SERVER)")
	return cmd
}

func newDown(o *options) *cobra.Command {
	return &cobra.Command{
		Use:   "down",
		Short: "Disconnect from the mesh but stay in the network (meshguard up reconnects)",
		Long: `Tears down the WireGuard interface and stops syncing. The device stays in
its network and keeps its keys and addresses; it stays down after the agent
restarts until you run meshguard up.`,
		Args: cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			var s ipc.Status
			if err := o.call(http.MethodPost, "/v1/down", nil, &s); err != nil {
				return err
			}
			fmt.Printf("Disconnected %s from %s. Run meshguard up to reconnect.\n", s.Device.Name, s.Network.Name)
			return nil
		},
	}
}

func newLogout(o *options) *cobra.Command {
	var force bool
	cmd := &cobra.Command{
		Use:   "logout",
		Short: "Leave the network: remove this device and forget its keys",
		Long: `Removes this device from its network on the control plane, disconnects,
and deletes its keys and state. Joining again needs a new token.`,
		Args: cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			before, _ := o.status()
			if err := o.call(http.MethodPost, "/v1/logout", ipc.LogoutRequest{Force: force}, nil); err != nil {
				return err
			}
			if before.Device != nil {
				fmt.Printf("Removed %s from %s.\n", before.Device.Name, before.Network.Name)
			} else {
				fmt.Println("Logged out.")
			}
			return nil
		},
	}
	cmd.Flags().BoolVar(&force, "force", false, "forget this device locally even if the control plane can't be reached")
	return cmd
}
