// Command mesh-relay forwards WireGuard packets between agents that can't reach
// each other directly. Agents connect out over WebSocket, so it works behind
// any NAT; it only ever sees WireGuard ciphertext.
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
	"time"

	"github.com/twinlabshq/mesh/internal/relay"
)

func main() {
	addr := flag.String("addr", envOr("RELAY_ADDR", ":3340"), "listen address")
	flag.Parse()

	if err := run(*addr); err != nil {
		slog.Error("relay exited", "err", err)
		os.Exit(1)
	}
}

func run(addr string) error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	srv, err := relay.NewServer()
	if err != nil {
		return err
	}
	mux := http.NewServeMux()
	mux.Handle("GET /relay", srv)
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "clients": srv.Clients()})
	})

	httpSrv := &http.Server{Addr: addr, Handler: mux, ReadHeaderTimeout: 10 * time.Second}
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = httpSrv.Shutdown(shutdownCtx)
	}()

	slog.Info("relay listening", "addr", addr)
	if err := httpSrv.ListenAndServe(); !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
