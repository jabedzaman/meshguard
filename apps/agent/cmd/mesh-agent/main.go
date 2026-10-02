// Command mesh-agent is the device daemon. It owns the device's keys and
// WireGuard interface and serves a local API to the desktop app and CLI.
package main

import (
	"context"
	"errors"
	"flag"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"github.com/twinlabshq/mesh/apps/agent/internal/agent"
	"github.com/twinlabshq/mesh/internal/ipc"
	"github.com/twinlabshq/mesh/internal/state"
)

var version = "dev"

func main() {
	socket := flag.String("socket", ipc.DefaultSocketPath(), "local API socket path")
	stateDir := flag.String("state-dir", state.DefaultDir(), "directory for keys and enrollment state")
	flag.Parse()

	if err := run(*socket, *stateDir); err != nil {
		slog.Error("agent exited", "err", err)
		os.Exit(1)
	}
}

func run(socket, stateDir string) error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	ln, err := ipc.Listen(socket)
	if err != nil {
		return err
	}

	a := &agent.Agent{Version: version, StateDir: stateDir}
	srv := &http.Server{Handler: a.Handler()}
	go func() {
		<-ctx.Done()
		srv.Shutdown(context.Background())
	}()

	slog.Info("agent listening", "socket", socket, "state", stateDir)
	if err := srv.Serve(ln); !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}
