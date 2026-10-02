package wireguard

import (
	"bufio"
	"encoding/hex"
	"fmt"
	"log/slog"
	"net/netip"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.zx2c4.com/wireguard/conn"
	"golang.zx2c4.com/wireguard/device"
	"golang.zx2c4.com/wireguard/tun"

	"github.com/twinlabshq/mesh/internal/relay"
)

// MTU leaves room for WireGuard's overhead on a 1500-byte path, plus IPv6.
const MTU = 1280

// Config describes the local interface.
type Config struct {
	// Requested TUN name ("mesh0" on Linux; macOS always assigns "utunN").
	InterfaceName string
	ListenPort    int
	PrivateKey    [32]byte
	// The device's mesh addresses with the network's prefix length, e.g.
	// 10.77.4.9/16 and fd12:3456:789a:0:..../48, so the whole network routes
	// through the interface.
	Addresses []netip.Prefix
}

// Engine is a running WireGuard interface.
type Engine struct {
	name string
	tun  tun.Device
	dev  *device.Device
	bind *Bind

	mu       sync.Mutex
	lastUAPI string
}

// Start creates the TUN interface, brings up WireGuard and configures
// addresses and routes. Needs root (CAP_NET_ADMIN on Linux).
func Start(cfg Config) (*Engine, error) {
	t, err := tun.CreateTUN(cfg.InterfaceName, MTU)
	if err != nil {
		return nil, fmt.Errorf("create tun %q (needs root): %w", cfg.InterfaceName, err)
	}
	name, err := t.Name()
	if err != nil {
		t.Close()
		return nil, err
	}

	logger := device.NewLogger(device.LogLevelError, "wireguard: ")
	bind := NewBind(conn.NewDefaultBind())
	dev := device.NewDevice(t, bind, logger)
	base := fmt.Sprintf("private_key=%s\nlisten_port=%d\n", hex.EncodeToString(cfg.PrivateKey[:]), cfg.ListenPort)
	if err := dev.IpcSet(base); err != nil {
		dev.Close()
		return nil, fmt.Errorf("configure wireguard: %w", err)
	}
	if err := dev.Up(); err != nil {
		dev.Close()
		return nil, fmt.Errorf("bring up wireguard: %w", err)
	}
	if err := configureInterface(name, cfg.Addresses); err != nil {
		dev.Close()
		return nil, fmt.Errorf("configure %s: %w", name, err)
	}
	slog.Info("wireguard up", "interface", name, "port", cfg.ListenPort, "addresses", cfg.Addresses)
	return &Engine{name: name, tun: t, dev: dev, bind: bind}, nil
}

// SetRelay sets how packets for relay/<key> endpoints are sent.
func (e *Engine) SetRelay(send RelaySender) { e.bind.SetRelay(send) }

// DeliverRelay hands a packet received from the relay to WireGuard.
func (e *Engine) DeliverRelay(p relay.Packet) { e.bind.Deliver(p) }

// Name is the actual interface name.
func (e *Engine) Name() string { return e.name }

// SetPeers replaces the peer list. A no-op if it hasn't changed.
func (e *Engine) SetPeers(peers []Peer) (changed bool, err error) {
	uapi, err := PeersUAPI(peers)
	if err != nil {
		return false, err
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	if uapi == e.lastUAPI {
		return false, nil
	}
	if err := e.dev.IpcSet(uapi); err != nil {
		return false, fmt.Errorf("set peers: %w", err)
	}
	e.lastUAPI = uapi
	return true, nil
}

// PeerStats is the live state of one peer.
type PeerStats struct {
	PublicKey     string // hex
	Endpoint      string
	LastHandshake time.Time
	RxBytes       uint64
	TxBytes       uint64
}

// Stats reads per-peer state from the device.
func (e *Engine) Stats() (map[string]PeerStats, error) {
	raw, err := e.dev.IpcGet()
	if err != nil {
		return nil, err
	}
	return parseStats(raw), nil
}

func parseStats(raw string) map[string]PeerStats {
	stats := map[string]PeerStats{}
	var cur *PeerStats
	var sec, nsec int64
	flush := func() {
		if cur != nil {
			if sec > 0 {
				cur.LastHandshake = time.Unix(sec, nsec)
			}
			stats[cur.PublicKey] = *cur
		}
	}
	scanner := bufio.NewScanner(strings.NewReader(raw))
	for scanner.Scan() {
		k, v, ok := strings.Cut(scanner.Text(), "=")
		if !ok {
			continue
		}
		switch k {
		case "public_key":
			flush()
			cur, sec, nsec = &PeerStats{PublicKey: v}, 0, 0
		case "endpoint":
			if cur != nil {
				cur.Endpoint = v
			}
		case "last_handshake_time_sec":
			sec, _ = strconv.ParseInt(v, 10, 64)
		case "last_handshake_time_nsec":
			nsec, _ = strconv.ParseInt(v, 10, 64)
		case "rx_bytes":
			if cur != nil {
				cur.RxBytes, _ = strconv.ParseUint(v, 10, 64)
			}
		case "tx_bytes":
			if cur != nil {
				cur.TxBytes, _ = strconv.ParseUint(v, 10, 64)
			}
		}
	}
	flush()
	return stats
}

// Close tears down the device and interface.
func (e *Engine) Close() {
	e.dev.Close()
}
