// Command mesh is the command-line interface to the local agent.
package main

import (
	"encoding/json"
	"fmt"
	"os"

	"github.com/twinlabshq/mesh/internal/ipc"
)

const usage = `usage: mesh <command>

commands:
  status    show agent and connection status`

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, usage)
		os.Exit(2)
	}

	var err error
	switch os.Args[1] {
	case "status":
		err = status()
	default:
		fmt.Fprintf(os.Stderr, "unknown command %q\n\n%s\n", os.Args[1], usage)
		os.Exit(2)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "mesh:", err)
		os.Exit(1)
	}
}

func status() error {
	socket := ipc.DefaultSocketPath()
	res, err := ipc.NewClient(socket).Get("http://agent/v1/status")
	if err != nil {
		return fmt.Errorf("agent not reachable at %s: %w", socket, err)
	}
	defer res.Body.Close()

	var s ipc.Status
	if err := json.NewDecoder(res.Body).Decode(&s); err != nil {
		return err
	}
	fmt.Printf("agent %s: %s\n", s.Version, s.State)
	return nil
}
