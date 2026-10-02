package wireguard

import (
	"encoding/hex"
	"errors"
	"net"
	"net/netip"
	"strings"
	"sync"

	"golang.zx2c4.com/wireguard/conn"

	"github.com/twinlabshq/mesh/internal/relay"
)

// RelayEndpointPrefix marks a peer endpoint that goes through the relay:
// "relay/<hex public key>".
const RelayEndpointPrefix = "relay/"

// RelayEndpoint addresses a peer through the relay by its public key.
type RelayEndpoint struct{ Key relay.Key }

func (e *RelayEndpoint) ClearSrc()           {}
func (e *RelayEndpoint) SrcToString() string { return "" }
func (e *RelayEndpoint) DstToString() string { return RelayEndpointString(e.Key) }
func (e *RelayEndpoint) DstToBytes() []byte  { return e.Key[:] }
func (e *RelayEndpoint) DstIP() netip.Addr   { return netip.Addr{} }
func (e *RelayEndpoint) SrcIP() netip.Addr   { return netip.Addr{} }

// RelayEndpointString is the UAPI endpoint for reaching key via the relay.
func RelayEndpointString(key relay.Key) string {
	return RelayEndpointPrefix + hex.EncodeToString(key[:])
}

// RelaySender sends a packet to a peer through the relay.
type RelaySender func(dst relay.Key, packet []byte) error

var errNoRelay = errors.New("no relay connected")

// Bind is WireGuard's transport: normal UDP, plus the relay for endpoints
// written as relay/<key>.
type Bind struct {
	std conn.Bind

	mu       sync.Mutex
	send     RelaySender
	incoming chan relay.Packet
	closed   chan struct{}
}

// NewBind wraps a UDP bind (conn.NewDefaultBind()).
func NewBind(std conn.Bind) *Bind {
	return &Bind{std: std, incoming: make(chan relay.Packet, 256)}
}

// SetRelay sets how relay packets are sent; nil disables the relay.
func (b *Bind) SetRelay(send RelaySender) {
	b.mu.Lock()
	b.send = send
	b.mu.Unlock()
}

// Deliver hands a packet received from the relay to WireGuard. Drops it if
// WireGuard is behind, as a congested UDP path would.
func (b *Bind) Deliver(p relay.Packet) {
	select {
	case b.incoming <- p:
	default:
	}
}

func (b *Bind) Open(port uint16) ([]conn.ReceiveFunc, uint16, error) {
	fns, actual, err := b.std.Open(port)
	if err != nil {
		return nil, 0, err
	}
	closed := make(chan struct{})
	b.mu.Lock()
	b.closed = closed
	b.mu.Unlock()

	receiveRelay := func(packets [][]byte, sizes []int, eps []conn.Endpoint) (int, error) {
		select {
		case p := <-b.incoming:
			sizes[0] = copy(packets[0], p.Data)
			eps[0] = &RelayEndpoint{Key: p.From}
			return 1, nil
		case <-closed:
			return 0, net.ErrClosed
		}
	}
	return append(fns, receiveRelay), actual, nil
}

func (b *Bind) Close() error {
	b.mu.Lock()
	if b.closed != nil {
		close(b.closed)
		b.closed = nil
	}
	b.mu.Unlock()
	return b.std.Close()
}

func (b *Bind) SetMark(mark uint32) error { return b.std.SetMark(mark) }

func (b *Bind) BatchSize() int { return b.std.BatchSize() }

func (b *Bind) Send(bufs [][]byte, ep conn.Endpoint) error {
	re, ok := ep.(*RelayEndpoint)
	if !ok {
		return b.std.Send(bufs, ep)
	}
	b.mu.Lock()
	send := b.send
	b.mu.Unlock()
	if send == nil {
		return errNoRelay
	}
	for _, buf := range bufs {
		if err := send(re.Key, buf); err != nil {
			return err
		}
	}
	return nil
}

func (b *Bind) ParseEndpoint(s string) (conn.Endpoint, error) {
	if hexKey, ok := strings.CutPrefix(s, RelayEndpointPrefix); ok {
		raw, err := hex.DecodeString(hexKey)
		if err != nil || len(raw) != relay.KeyLen {
			return nil, errors.New("invalid relay endpoint")
		}
		return &RelayEndpoint{Key: relay.Key(raw)}, nil
	}
	return b.std.ParseEndpoint(s)
}
