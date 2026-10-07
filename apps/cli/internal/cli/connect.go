package cli

import (
	"fmt"
	"net/http"
	"os"
	"strings"

	"github.com/spf13/cobra"

	"github.com/jabedzaman/meshguard/internal/ipc"
)

// DefaultServer is the control plane used when neither --server nor
// $MESHGUARD_SERVER is set. Release builds set it with
// -ldflags "-X .../internal/cli.DefaultServer=https://api.example.com".
var DefaultServer = "http://localhost:4000"

func defaultServer() string {
	if s := os.Getenv("MESHGUARD_SERVER"); s != "" {
		return s
	}
	return DefaultServer
}

func newUp(o *options) *cobra.Command {
	var token, server string
	var noBrowser bool
	cmd := &cobra.Command{
		Use:   "up",
		Short: "Join a network (browser login or token), or reconnect after meshguard down",
		Long: `Without a token, an unenrolled device is joined through your browser: the
CLI prints a URL, you approve the device for a network there, and it joins as
yours. Pass --token for machines without a browser (servers, CI). An enrolled
device just reconnects.`,
		Example: `  meshguard up                                        # join through the browser, or reconnect after meshguard down
  meshguard up --token meshguard_enr_...                   # join with a token (the network's Add device)
  meshguard up --token meshguard_enr_... --server https://api.example.com
`,
		Args: cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			if token == "" {
				// An enrolled device reconnects; an unenrolled one joins through the browser.
				if before, err := o.status(); err == nil && before.Device == nil {
					t, err := browserLogin(cmd.Context(), strings.TrimRight(server, "/"), noBrowser)
					if err != nil {
						return err
					}
					token = t
				}
			}
			return o.up(token, server)
		},
	}
	cmd.Flags().StringVar(&token, "token", "", "enrollment token (meshguard_enr_...)")
	cmd.Flags().BoolVar(&noBrowser, "no-browser", false, "print the login URL without opening a browser")
	cmd.Flags().StringVar(&server, "server", defaultServer(), "control plane URL ($MESHGUARD_SERVER)")
	return cmd
}

// up enrolls with the token, or (no token) reconnects an enrolled device.
func (o *options) up(token, server string) error {
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
}

func newLogin(o *options) *cobra.Command {
	var server string
	var noBrowser bool
	cmd := &cobra.Command{
		Use:   "login",
		Short: "Sign in through your browser and join a network as yourself",
		Long: `Prints a URL, you approve this device for a network there, and it joins as
yours. For machines without a browser, use meshguard up --token. Undo with
meshguard logout.`,
		Args: cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			if before, err := o.status(); err == nil && before.Device != nil {
				fmt.Printf("Already logged in: %s in %s. Run meshguard logout first to join another network.\n",
					before.Device.Name, before.Network.Name)
				return nil
			}
			token, err := browserLogin(cmd.Context(), strings.TrimRight(server, "/"), noBrowser)
			if err != nil {
				return err
			}
			return o.up(token, server)
		},
	}
	cmd.Flags().BoolVar(&noBrowser, "no-browser", false, "print the login URL without opening a browser")
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
