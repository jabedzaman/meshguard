package wireguard

import (
	"encoding/hex"
	"errors"
	"net"
	"net/netip"
	"strings"
	"sync"

	"golang.zx2c4.com/wireguard/conn"

	"github.com/jabedzaman/meshguard/internal/relay"
)

// PeerEndpointPrefix marks a peer endpoint the bind routes itself:
// "peer/<hex public key>". WireGuard always sends to the peer; the bind picks
// the path per packet (a confirmed direct address, else the relay), so path
// changes never touch WireGuard's config or its handshakes.
const PeerEndpointPrefix = "peer/"

// PeerEndpoint addresses a peer by its public key.
type PeerEndpoint struct{ Key relay.Key }

func (e *PeerEndpoint) ClearSrc()           {}
func (e *PeerEndpoint) SrcToString() string { return "" }
func (e *PeerEndpoint) DstToString() string { return PeerEndpointString(e.Key) }
func (e *PeerEndpoint) DstToBytes() []byte  { return e.Key[:] }
func (e *PeerEndpoint) DstIP() netip.Addr   { return netip.Addr{} }
func (e *PeerEndpoint) SrcIP() netip.Addr   { return netip.Addr{} }

// PeerEndpointString is the UAPI endpoint for reaching key.
func PeerEndpointString(key relay.Key) string {
	return PeerEndpointPrefix + hex.EncodeToString(key[:])
}

// Router picks the UDP address for a peer's packets. direct means the path
// is confirmed; otherwise the relay is used if there is one, and addr (if
// valid) is only a guess to try without it.
type Router func(key relay.Key) (addr netip.AddrPort, direct bool)

// RelaySender sends a packet to a peer through the relay.
type RelaySender func(dst relay.Key, packet []byte) error

var errNoRelay = errors.New("no relay connected")

// Bind is WireGuard's transport: normal UDP, plus peer/<key> endpoints sent
// directly or through the relay as the Router decides.
type Bind struct {
	std conn.Bind

	mu        sync.Mutex
	send      RelaySender
	route     Router
	intercept Interceptor
	incoming  chan relay.Packet
	closed    chan struct{}
}

// Interceptor sees every UDP packet before WireGuard does and returns true to
// consume it (STUN responses, disco pings and pongs).
type Interceptor func(packet []byte, from netip.AddrPort) bool

// SetInterceptor installs the interceptor; nil passes everything to WireGuard.
func (b *Bind) SetInterceptor(i Interceptor) {
	b.mu.Lock()
	b.intercept = i
	b.mu.Unlock()
}

// SendTo sends a raw packet from WireGuard's UDP socket, so NAT mappings and
// STUN results apply to WireGuard traffic too.
func (b *Bind) SendTo(to netip.AddrPort, packet []byte) error {
	ep, err := b.std.ParseEndpoint(to.String())
	if err != nil {
		return err
	}
	return b.std.Send([][]byte{packet}, ep)
}

// filter wraps a UDP receive function, removing packets the interceptor
// consumes and compacting the batch for WireGuard.
func (b *Bind) filter(receive conn.ReceiveFunc) conn.ReceiveFunc {
	return func(packets [][]byte, sizes []int, eps []conn.Endpoint) (int, error) {
		for {
			n, err := receive(packets, sizes, eps)
			if err != nil || n == 0 {
				return n, err
			}
			b.mu.Lock()
			intercept := b.intercept
			b.mu.Unlock()
			if intercept == nil {
				return n, nil
			}
			kept := 0
			for i := 0; i < n; i++ {
				from, perr := netip.ParseAddrPort(eps[i].DstToString())
				if perr == nil && intercept(packets[i][:sizes[i]], from) {
					continue
				}
				if kept != i {
					// Move the bytes, not the slices: wireguard-go reads
					// each packet from the buffer it passed at that index.
					sizes[kept] = copy(packets[kept], packets[i][:sizes[i]])
					eps[kept] = eps[i]
				}
				kept++
			}
			if kept > 0 {
				return kept, nil
			}
			// Everything was STUN/disco; keep reading rather than hand
			// WireGuard an empty batch.
		}
	}
}

// NewBind wraps a UDP bind (conn.NewDefaultBind()).
func NewBind(std conn.Bind) *Bind {
	return &Bind{std: std, incoming: make(chan relay.Packet, 256)}
}

// SetRouter sets how peer/<key> endpoints map to UDP addresses; nil sends
// them all through the relay.
func (b *Bind) SetRouter(r Router) {
	b.mu.Lock()
	b.route = r
	b.mu.Unlock()
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
	for i, fn := range fns {
		fns[i] = b.filter(fn)
	}
	closed := make(chan struct{})
	b.mu.Lock()
	b.closed = closed
	b.mu.Unlock()

	receiveRelay := func(packets [][]byte, sizes []int, eps []conn.Endpoint) (int, error) {
		select {
		case p := <-b.incoming:
			sizes[0] = copy(packets[0], p.Data)
			eps[0] = &PeerEndpoint{Key: p.From}
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
	pe, ok := ep.(*PeerEndpoint)
	if !ok {
		return b.std.Send(bufs, ep)
	}
	b.mu.Lock()
	send, route := b.send, b.route
	b.mu.Unlock()
	var addr netip.AddrPort
	var direct bool
	if route != nil {
		addr, direct = route(pe.Key)
	}
	if direct || (send == nil && addr.IsValid()) {
		udp, err := b.std.ParseEndpoint(addr.String())
		if err != nil {
			return err
		}
		return b.std.Send(bufs, udp)
	}
	if send == nil {
		return errNoRelay
	}
	for _, buf := range bufs {
		if err := send(pe.Key, buf); err != nil {
			return err
		}
	}
	return nil
}

func (b *Bind) ParseEndpoint(s string) (conn.Endpoint, error) {
	if hexKey, ok := strings.CutPrefix(s, PeerEndpointPrefix); ok {
		raw, err := hex.DecodeString(hexKey)
		if err != nil || len(raw) != relay.KeyLen {
			return nil, errors.New("invalid peer endpoint")
		}
		return &PeerEndpoint{Key: relay.Key(raw)}, nil
	}
	return b.std.ParseEndpoint(s)
}
