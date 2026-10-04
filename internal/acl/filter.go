package acl

import (
	"net/netip"
	"slices"
	"sync"
	"sync/atomic"
	"time"
)

// Protocol a rule applies to.
type Protocol string

const (
	Any  Protocol = "any"
	TCP  Protocol = "tcp"
	UDP  Protocol = "udp"
	ICMP Protocol = "icmp" // ICMP and ICMPv6
)

// Rule lets matching packets from peers in.
type Rule struct {
	// Who may connect; empty means any peer.
	Sources  []netip.Prefix
	Protocol Protocol
	// TCP/UDP destination ports, inclusive. PortFirst 0 means every port.
	PortFirst, PortLast uint16
}

// Policy is what may reach this device.
type Policy struct {
	// Everything may reach this device; Rules are ignored.
	AllowAll bool
	Rules    []Rule
}

// AllowAllPolicy lets everything in: networks without access rules.
var AllowAllPolicy = Policy{AllowAll: true}

const (
	// A tracked flow is forgotten after this long without an outbound packet.
	flowTimeout = 5 * time.Minute
	sweepEvery  = 30 * time.Second
	maxFlows    = 1 << 16
)

// flow is a connection this device opened, keyed as its replies look.
type flow struct {
	proto                 uint8
	remote, local         netip.Addr
	remotePort, localPort uint16
}

// Filter decides which packets from peers reach the device. Outbound
// packets are recorded so replies to connections this device opened pass
// whatever the rules say. Safe for concurrent use.
type Filter struct {
	policy  atomic.Pointer[Policy]
	dropped atomic.Uint64
	now     func() time.Time

	mu        sync.Mutex
	flows     map[flow]time.Time
	lastSweep time.Time
}

// NewFilter returns a filter enforcing p.
func NewFilter(p Policy) *Filter {
	f := &Filter{now: time.Now, flows: map[flow]time.Time{}}
	f.SetPolicy(p)
	return f
}

// SetPolicy replaces the rules; tracked flows are kept.
func (f *Filter) SetPolicy(p Policy) { f.policy.Store(&p) }

// Policy is the policy being enforced.
func (f *Filter) Policy() Policy { return *f.policy.Load() }

// Dropped counts packets refused so far.
func (f *Filter) Dropped() uint64 { return f.dropped.Load() }

// Outbound records a packet this device sends to a peer.
func (f *Filter) Outbound(b []byte) {
	p, ok := parse(b)
	if !ok || p.fragment {
		return
	}
	switch {
	case p.proto == protoTCP || p.proto == protoUDP, p.isEchoRequest():
	default:
		return
	}
	key := flow{proto: p.proto, remote: p.dst, local: p.src, remotePort: p.dstPort, localPort: p.srcPort}
	now := f.now()

	f.mu.Lock()
	defer f.mu.Unlock()
	if now.Sub(f.lastSweep) >= sweepEvery || len(f.flows) >= maxFlows {
		f.sweepLocked(now)
	}
	if len(f.flows) >= maxFlows {
		// Still full of live flows: start over rather than grow without bound.
		clear(f.flows)
	}
	f.flows[key] = now
}

func (f *Filter) sweepLocked(now time.Time) {
	for k, seen := range f.flows {
		if now.Sub(seen) > flowTimeout {
			delete(f.flows, k)
		}
	}
	f.lastSweep = now
}

// Allow reports whether a packet from a peer may reach this device.
func (f *Filter) Allow(b []byte) bool {
	if f.allow(b) {
		return true
	}
	f.dropped.Add(1)
	return false
}

func (f *Filter) allow(b []byte) bool {
	policy := f.policy.Load()
	if policy.AllowAll {
		return true
	}
	p, ok := parse(b)
	if !ok {
		return false
	}
	// The first fragment was checked; without it the rest can't be reassembled.
	if p.fragment || p.isICMPError() {
		return true
	}
	if p.proto == protoTCP || p.proto == protoUDP || p.isEchoReply() {
		key := flow{proto: p.proto, remote: p.src, local: p.dst, remotePort: p.srcPort, localPort: p.dstPort}
		f.mu.Lock()
		seen, tracked := f.flows[key]
		f.mu.Unlock()
		if tracked && f.now().Sub(seen) <= flowTimeout {
			return true
		}
	}
	return slices.ContainsFunc(policy.Rules, func(r Rule) bool { return r.matches(p) })
}

func (r Rule) matches(p packet) bool {
	if len(r.Sources) > 0 && !slices.ContainsFunc(r.Sources, func(s netip.Prefix) bool { return s.Contains(p.src) }) {
		return false
	}
	switch r.Protocol {
	case Any:
		return true
	case ICMP:
		return p.proto == protoICMP || p.proto == protoICMPv6
	case TCP, UDP:
		want := uint8(protoTCP)
		if r.Protocol == UDP {
			want = protoUDP
		}
		return p.proto == want && (r.PortFirst == 0 || (p.dstPort >= r.PortFirst && p.dstPort <= r.PortLast))
	}
	return false
}

// Allows reports whether the policy lets src open a new connection to this
// device (port is ignored for ICMP; 0 matches only rules for every port).
// Replies to connections this device opened aren't considered.
func (p Policy) Allows(src netip.Addr, proto Protocol, port uint16) bool {
	if p.AllowAll {
		return true
	}
	pkt := packet{src: src, dstPort: port}
	switch proto {
	case TCP:
		pkt.proto = protoTCP
	case UDP:
		pkt.proto = protoUDP
	case ICMP:
		pkt.proto = protoICMP
		if src.Is6() {
			pkt.proto = protoICMPv6
		}
	default:
		return false
	}
	return slices.ContainsFunc(p.Rules, func(r Rule) bool { return r.matches(pkt) })
}
