// Command meshguard-relay forwards WireGuard packets between agents that can't reach
// each other directly, and runs a STUN server so agents can learn their public
// address for hole punching. Agents connect out over WebSocket, so relaying
// works behind any NAT; it only ever sees WireGuard ciphertext.
//
// With RELAY_FUNNEL_ADDR set it also accepts visitors from the internet for names
// agents may serve (funnels) and carries their TLS connections to the agents.
//
// With RELAY_TRUST_KEY set, it only serves agents holding a relay token from
// the control plane. `meshguard-relay -gen-key` prints a matching pair:
// RELAY_TOKEN_KEY for the API, RELAY_TRUST_KEY for the relay.
package main

import (
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/jabedzaman/meshguard/internal/relay"
	"github.com/jabedzaman/meshguard/internal/stun"
)

func main() {
	addr := flag.String("addr", envOr("RELAY_ADDR", ":3340"), "relay (WebSocket) listen address")
	stunAddr := flag.String("stun-addr", envOr("STUN_ADDR", ":3478"), `STUN (UDP) listen addresses, comma-separated; "" to disable`)
	funnelAddr := flag.String("funnel-addr", os.Getenv("RELAY_FUNNEL_ADDR"), `public TLS listen address for funnels, e.g. ":443"; "" turns funnels off`)
	trustKey := flag.String("trust-key", os.Getenv("RELAY_TRUST_KEY"), "base64 Ed25519 public key of the control plane's relay tokens; empty serves any agent")
	genKey := flag.Bool("gen-key", false, "print a new RELAY_TOKEN_KEY (API) and RELAY_TRUST_KEY (relay) pair and exit")
	flag.Parse()

	if *genKey {
		public, private, err := ed25519.GenerateKey(nil)
		if err != nil {
			slog.Error("generating key", "err", err)
			os.Exit(1)
		}
		fmt.Printf("RELAY_TOKEN_KEY=%s\nRELAY_TRUST_KEY=%s\n",
			base64.StdEncoding.EncodeToString(private.Seed()), base64.StdEncoding.EncodeToString(public))
		return
	}
	var trust ed25519.PublicKey
	if *trustKey != "" {
		raw, err := base64.StdEncoding.DecodeString(*trustKey)
		if err != nil || len(raw) != ed25519.PublicKeySize {
			slog.Error("RELAY_TRUST_KEY must be a base64 Ed25519 public key")
			os.Exit(1)
		}
		trust = raw
	}

	if *funnelAddr != "" && trust == nil {
		slog.Error("funnels need RELAY_TRUST_KEY: they serve only names the control plane signed for an agent")
		os.Exit(1)
	}
	if err := run(*addr, *stunAddr, *funnelAddr, trust); err != nil {
		slog.Error("relay exited", "err", err)
		os.Exit(1)
	}
}

func run(addr, stunAddr, funnelAddr string, trust ed25519.PublicKey) error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	// STUN tells agents their public address, for hole punching. Two ports
	// let agents tell symmetric NATs apart (meshguard netcheck).
	for _, a := range strings.Split(stunAddr, ",") {
		if a = strings.TrimSpace(a); a == "" {
			continue
		}
		pc, err := net.ListenPacket("udp", a)
		if err != nil {
			return err
		}
		slog.Info("stun listening", "addr", a)
		go func() {
			if err := stun.Serve(ctx, pc); err != nil {
				slog.Error("stun stopped", "err", err)
			}
		}()
	}

	srv, err := relay.NewServer()
	if err != nil {
		return err
	}
	srv.Trust = trust
	if trust == nil {
		slog.Warn("no RELAY_TRUST_KEY: serving any agent")
	}
	// Funnels: visitors from the internet reach an agent that may serve the name
	// they ask for; their TLS passes through untouched.
	if funnelAddr != "" {
		ln, err := net.Listen("tcp", funnelAddr)
		if err != nil {
			return err
		}
		slog.Info("funnel listening", "addr", funnelAddr)
		go func() {
			if err := srv.ServeFunnel(ctx, ln); err != nil {
				slog.Error("funnel stopped", "err", err)
			}
		}()
	}
	mux := http.NewServeMux()
	mux.Handle("GET /relay", srv)
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "clients": srv.Clients(), "streams": srv.Streams()})
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
