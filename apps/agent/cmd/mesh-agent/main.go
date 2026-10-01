// Command mesh-agent is the device daemon. It owns the WireGuard interface and
// serves a local API to the desktop app and CLI.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"github.com/twinlabshq/mesh/internal/ipc"
)

var version = "dev"

func main() {
	socket := flag.String("socket", ipc.DefaultSocketPath(), "local API socket path")
	flag.Parse()

	if err := run(*socket); err != nil {
		slog.Error("agent exited", "err", err)
		os.Exit(1)
	}
}

func run(socket string) error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	ln, err := ipc.Listen(socket)
	if err != nil {
		return err
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /v1/status", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(ipc.Status{Version: version, State: "disconnected"})
	})

	srv := &http.Server{Handler: mux}
	go func() {
		<-ctx.Done()
		srv.Shutdown(context.Background())
	}()

	slog.Info("agent listening", "socket", socket)
	if err := srv.Serve(ln); !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}
