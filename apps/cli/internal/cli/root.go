// Package cli implements the mesh command-line interface. Every command talks
// to the local agent (mesh-agent) over its Unix socket.
package cli

import (
	"os"

	"github.com/spf13/cobra"

	"github.com/twinlabshq/mesh/internal/ipc"
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
		Use:   "mesh",
		Short: "Connect this machine to your private mesh network",
		Long: `mesh controls the local mesh agent: join a network, see peers and how
they're reached, diagnose connectivity.

The agent must be running: sudo mesh-agent install (or sudo mesh-agent).`,
		SilenceUsage:  true,
		SilenceErrors: false,
	}
	root.PersistentFlags().StringVar(&o.socket, "socket", ipc.DefaultSocketPath(),
		"agent socket ($MESH_SOCKET)")

	root.AddCommand(
		newUp(o), newDown(o), newLogout(o),
		newStatus(o), newPeers(o), newIP(o), newPing(o), newNetcheck(o),
		newVersion(o),
	)
	return root
}
