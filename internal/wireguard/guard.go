package wireguard

import (
	"net/netip"
	"sync"
	"time"
)

// A forwardGuard stops a device that connects domains for its peers from being
// an open router. Everything a peer sends to an address outside the mesh and
// the subnets the device was approved to route is dropped unless the device
// itself resolved that address a moment ago for a domain it connects. Without
// it, any peer could send anything to the internet through the device.
type forwardGuard struct {
	mu      sync.Mutex
	on      bool
	mesh    []netip.Prefix
	served  []netip.Prefix
	learned map[netip.Addr]time.Time
	now     func() time.Time
	sweeped time.Time
}

func newForwardGuard() *forwardGuard {
	return &forwardGuard{learned: map[netip.Addr]time.Time{}, now: time.Now}
}

// configure turns the guard on or off and sets the ranges that always pass.
func (g *forwardGuard) configure(on bool, mesh, served []netip.Prefix) {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.on, g.mesh, g.served = on, mesh, served
	if !on {
		clear(g.learned)
	}
}

// learn lets peers reach addrs for ttl.
func (g *forwardGuard) learn(addrs []netip.Addr, ttl time.Duration) {
	g.mu.Lock()
	defer g.mu.Unlock()
	until := g.now().Add(ttl)
	for _, a := range addrs {
		a = a.Unmap()
		if until.After(g.learned[a]) {
			g.learned[a] = until
		}
	}
}

// allow reports whether a packet from a peer may pass.
func (g *forwardGuard) allow(b []byte) bool {
	g.mu.Lock()
	defer g.mu.Unlock()
	if !g.on {
		return true
	}
	dst, ok := packetDestination(b)
	if !ok {
		return false
	}
	for _, ranges := range [][]netip.Prefix{g.mesh, g.served} {
		for _, p := range ranges {
			if p.Contains(dst) {
				return true
			}
		}
	}
	now := g.now()
	if now.Sub(g.sweeped) > time.Minute {
		for a, until := range g.learned {
			if !now.Before(until) {
				delete(g.learned, a)
			}
		}
		g.sweeped = now
	}
	until, known := g.learned[dst]
	return known && now.Before(until)
}

// packetDestination reads the destination address of an IPv4 or IPv6 packet.
func packetDestination(b []byte) (netip.Addr, bool) {
	if len(b) < 1 {
		return netip.Addr{}, false
	}
	switch b[0] >> 4 {
	case 4:
		if len(b) < 20 {
			return netip.Addr{}, false
		}
		return netip.AddrFrom4([4]byte(b[16:20])), true
	case 6:
		if len(b) < 40 {
			return netip.Addr{}, false
		}
		return netip.AddrFrom16([16]byte(b[24:40])), true
	}
	return netip.Addr{}, false
}
