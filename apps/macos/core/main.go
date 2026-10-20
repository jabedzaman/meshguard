// Package main builds as a C archive (-buildmode=c-archive) that the macOS
// Network Extension links. The extension owns the utun and applies addresses,
// routes and DNS through NEPacketTunnelNetworkSettings; this side runs the
// WireGuard engine on the descriptor it is handed.
package main

import "C"

import (
	"encoding/hex"
	"encoding/json"
	"log/slog"
	"net/netip"
	"os"
	"sync"

	"golang.zx2c4.com/wireguard/tun"

	"github.com/jabedzaman/meshguard/internal/wireguard"
)

var (
	mu     sync.Mutex
	engine *wireguard.Engine
)

type startConfig struct {
	PrivateKey string   `json:"privateKey"` // hex
	ListenPort int      `json:"listenPort"`
	Addresses  []string `json:"addresses"`
}

// MGStart runs WireGuard on an open utun descriptor. Returns 0, or a negative
// code: -1 bad config, -2 tun, -3 engine.
//
//export MGStart
func MGStart(fd C.int, cfgJSON *C.char) C.int {
	mu.Lock()
	defer mu.Unlock()
	if engine != nil {
		return 0
	}
	var in startConfig
	if err := json.Unmarshal([]byte(C.GoString(cfgJSON)), &in); err != nil {
		slog.Error("bad config", "err", err)
		return -1
	}
	key, err := hex.DecodeString(in.PrivateKey)
	if err != nil || len(key) != 32 {
		slog.Error("bad private key")
		return -1
	}
	cfg := wireguard.Config{ListenPort: in.ListenPort}
	copy(cfg.PrivateKey[:], key)
	for _, a := range in.Addresses {
		p, err := netip.ParsePrefix(a)
		if err != nil {
			slog.Error("bad address", "address", a)
			return -1
		}
		cfg.Addresses = append(cfg.Addresses, p)
	}
	t, err := tun.CreateTUNFromFile(os.NewFile(uintptr(fd), "utun"), wireguard.MTU)
	if err != nil {
		slog.Error("tun from fd", "err", err)
		return -2
	}
	cfg.TUN = t
	e, err := wireguard.Start(cfg)
	if err != nil {
		slog.Error("start", "err", err)
		return -3
	}
	engine = e
	return 0
}

// MGStop tears the engine down.
//
//export MGStop
func MGStop() {
	mu.Lock()
	defer mu.Unlock()
	if engine != nil {
		engine.Close()
		engine = nil
	}
}

func main() {}
