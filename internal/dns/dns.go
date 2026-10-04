// Package dns answers private mesh names: every device in the network
// resolves as <name>.internal (".internal" is reserved by ICANN for private
// use), and its mesh addresses resolve back to that name. The agent answers
// queries the OS sends to the network's resolver address (ResolverAddr) inside
// its TUN, so no socket is bound, and points the OS resolver there for those
// zones only.
package dns

import (
	"encoding/binary"
	"errors"
	"net/netip"
	"slices"
	"strings"
	"sync"

	"golang.org/x/net/dns/dnsmessage"
)

// Domain is the zone the server answers, without the trailing dot.
const Domain = "internal"

// TTL of answers. Short: names follow devices that come and go.
const TTL = 30

// resolverOffset places the resolver in a network: base + 53, e.g. 10.77.0.53
// in 10.77.0.0/16. The control plane never gives it to a device
// (DNS_RESOLVER_OFFSET in server-core). Networks are /8 to /24, so it fits.
const resolverOffset = 53

// ResolverAddr is where the OS sends queries for an IPv4 mesh network. It's
// inside the network, so the network's route already takes it into the TUN,
// where the agent answers instead of a peer. Invalid if network is too small.
func ResolverAddr(network netip.Prefix) netip.Addr {
	network = network.Masked()
	if !network.Addr().Is4() || network.Bits() > 26 { // a /26 is the smallest with a .53
		return netip.Addr{}
	}
	b := network.Addr().As4()
	n := binary.BigEndian.Uint32(b[:]) + resolverOffset
	return netip.AddrFrom4([4]byte(binary.BigEndian.AppendUint32(nil, n)))
}

// Record is one device's addresses. Either may be invalid (not assigned).
type Record struct {
	IPv4 netip.Addr
	IPv6 netip.Addr
}

// Server answers A and AAAA queries for <name>.internal and PTR queries for
// the mesh's addresses from the records it was last given, NXDOMAIN for
// unknown names and REFUSED outside its zones.
type Server struct {
	mu      sync.RWMutex
	records map[string]Record
	names   map[netip.Addr]string // reverse of records
	reverse []string              // reverse zones, see SetNetworks
	addr    netip.Addr            // where queries arrive, see SetNetworks
}

// SetRecords replaces the records, keyed by device name (a DNS label).
func (s *Server) SetRecords(records map[string]Record) {
	m := make(map[string]Record, len(records))
	names := make(map[netip.Addr]string, 2*len(records))
	for name, r := range records {
		name = strings.ToLower(name)
		m[name] = r
		for _, ip := range []netip.Addr{r.IPv4, r.IPv6} {
			if ip.IsValid() {
				names[ip] = name
			}
		}
	}
	s.mu.Lock()
	s.records, s.names = m, names
	s.mu.Unlock()
}

// SetNetworks sets the mesh's prefixes: queries arrive at the IPv4 network's
// ResolverAddr, and the server answers their reverse zones.
func (s *Server) SetNetworks(prefixes []netip.Prefix) {
	zones := ReverseZones(prefixes)
	var addr netip.Addr
	for _, p := range prefixes {
		if a := ResolverAddr(p); a.IsValid() {
			addr = a
		}
	}
	s.mu.Lock()
	s.reverse, s.addr = zones, addr
	s.mu.Unlock()
}

// Addr is where the server takes queries; invalid until SetNetworks.
func (s *Server) Addr() netip.Addr {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.addr
}

// Name returns the fully qualified name for a device, e.g. "laptop.internal".
func Name(device string) string {
	return strings.ToLower(device) + "." + Domain
}

// Answer builds the response to one DNS query message.
func (s *Server) Answer(query []byte) ([]byte, error) {
	var p dnsmessage.Parser
	header, err := p.Start(query)
	if err != nil {
		return nil, err
	}
	if header.Response {
		return nil, errors.New("not a query")
	}
	q, err := p.Question()
	if err != nil {
		return reply(header, nil, dnsmessage.RCodeFormatError, nil)
	}
	if header.OpCode != 0 {
		return reply(header, &q, dnsmessage.RCodeNotImplemented, nil)
	}

	name := strings.ToLower(strings.TrimSuffix(q.Name.String(), "."))
	s.mu.RLock()
	defer s.mu.RUnlock()
	if label, ok := strings.CutSuffix(name, "."+Domain); ok {
		return s.answerName(header, q, label)
	}
	if name == Domain || slices.Contains(s.reverse, name) {
		return reply(header, &q, dnsmessage.RCodeSuccess, nil)
	}
	for _, zone := range s.reverse {
		if strings.HasSuffix(name, "."+zone) {
			return s.answerAddr(header, q, name)
		}
	}
	return reply(header, &q, dnsmessage.RCodeRefused, nil)
}

// answerName answers <label>.internal. Caller holds s.mu.
func (s *Server) answerName(header dnsmessage.Header, q dnsmessage.Question, label string) ([]byte, error) {
	r, ok := s.records[label]
	if !ok || strings.Contains(label, ".") {
		return reply(header, &q, dnsmessage.RCodeNameError, nil)
	}

	var answers []dnsmessage.Resource
	rh := dnsmessage.ResourceHeader{Name: q.Name, Class: dnsmessage.ClassINET, TTL: TTL}
	if (q.Type == dnsmessage.TypeA || q.Type == dnsmessage.TypeALL) && r.IPv4.Is4() {
		rh.Type = dnsmessage.TypeA
		answers = append(answers, dnsmessage.Resource{Header: rh, Body: &dnsmessage.AResource{A: r.IPv4.As4()}})
	}
	if (q.Type == dnsmessage.TypeAAAA || q.Type == dnsmessage.TypeALL) && r.IPv6.Is6() {
		rh.Type = dnsmessage.TypeAAAA
		answers = append(answers, dnsmessage.Resource{Header: rh, Body: &dnsmessage.AAAAResource{AAAA: r.IPv6.As16()}})
	}
	// Other types for a known name: NOERROR with no answers (NODATA).
	return reply(header, &q, dnsmessage.RCodeSuccess, answers)
}

// answerAddr answers a name in one of the mesh's reverse zones. Caller holds s.mu.
func (s *Server) answerAddr(header dnsmessage.Header, q dnsmessage.Question, name string) ([]byte, error) {
	ip, ok := parseReverse(name)
	device, known := s.names[ip]
	if !ok || !known {
		return reply(header, &q, dnsmessage.RCodeNameError, nil)
	}
	var answers []dnsmessage.Resource
	if q.Type == dnsmessage.TypePTR || q.Type == dnsmessage.TypeALL {
		target, err := dnsmessage.NewName(Name(device) + ".")
		if err != nil {
			return nil, err
		}
		answers = append(answers, dnsmessage.Resource{
			Header: dnsmessage.ResourceHeader{Name: q.Name, Type: dnsmessage.TypePTR, Class: dnsmessage.ClassINET, TTL: TTL},
			Body:   &dnsmessage.PTRResource{PTR: target},
		})
	}
	return reply(header, &q, dnsmessage.RCodeSuccess, answers)
}

func reply(query dnsmessage.Header, q *dnsmessage.Question, rcode dnsmessage.RCode, answers []dnsmessage.Resource) ([]byte, error) {
	msg := dnsmessage.Message{
		Header: dnsmessage.Header{
			ID:               query.ID,
			Response:         true,
			Authoritative:    rcode != dnsmessage.RCodeRefused,
			RecursionDesired: query.RecursionDesired,
			RCode:            rcode,
		},
		Answers: answers,
	}
	if q != nil {
		msg.Questions = []dnsmessage.Question{*q}
	}
	return msg.Pack()
}
