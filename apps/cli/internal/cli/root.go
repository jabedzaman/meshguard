// Package cli implements the meshguard command-line interface. Every command talks
// to the local agent (meshguard-agent) over its Unix socket.
package cli

import (
	"os"

	"github.com/spf13/cobra"

	"github.com/jabedzaman/meshguard/internal/ipc"
)

// Version is set at build time (-ldflags "-X .../internal/cli.Version=...").
var Version = "dev"

type options struct {
	socket string
	json   bool
}

// Execute runs the CLI.
func Execute() {
	if err := newRoot().Execute(); err != nil {
		os.Exit(1)
	}
}

func newRoot() *cobra.Command {
	o := &options{}
	root := &cobra.Command{
		Use:   "meshguard",
		Short: "Connect this machine to your private mesh network",
		Long: `meshguard controls the local MeshGuard agent: join a network, see peers and how
they're reached, diagnose connectivity.

The agent must be running: sudo meshguard-agent install (or sudo meshguard-agent).`,
		SilenceUsage:  true,
		SilenceErrors: false,
	}
	root.PersistentFlags().StringVar(&o.socket, "socket", ipc.DefaultSocketPath(),
		"agent socket ($MESHGUARD_SOCKET)")

	root.AddCommand(
		newLogin(o), newUp(o), newDown(o), newLogout(o),
		newStatus(o), newSet(o), newServe(o), newFunnel(o), newCert(o), newServices(o), newPeers(o), newIP(o), newPing(o), newNetcheck(o), newDoctor(o),
		newVersion(o),
	)
	return root
}
