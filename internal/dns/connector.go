package dns

import (
	"context"
	"errors"
	"net"
	"net/netip"
	"strings"

	"golang.org/x/net/dns/dnsmessage"
)

// App connectors send the traffic for some domains through a chosen device:
// the clients' agents forward those names' queries to the connector's agent,
// which resolves them with the system resolver, and route the addresses it
// answers through it. This file is the DNS part, both ends.

// MatchDomain reports whether name is one of domains or under one of them
// (both lower case, without trailing dots).
func MatchDomain(name string, domains []string) bool {
	for _, d := range domains {
		if name == d || strings.HasSuffix(name, "."+d) {
			return true
		}
	}
	return false
}

// QuestionName returns the lower-case name asked in a query message, without
// the trailing dot.
func QuestionName(query []byte) (string, bool) {
	var p dnsmessage.Parser
	h, err := p.Start(query)
	if err != nil || h.Response {
		return "", false
	}
	q, err := p.Question()
	if err != nil {
		return "", false
	}
	return strings.ToLower(strings.TrimSuffix(q.Name.String(), ".")), true
}

// Lookup resolves host to addresses of one family ("ip4" or "ip6") the way the
// machine itself would.
type Lookup func(ctx context.Context, network, host string) ([]netip.Addr, error)

// SystemLookup uses the system's resolver (hosts file, resolv.conf, ...).
func SystemLookup(ctx context.Context, network, host string) ([]netip.Addr, error) {
	return net.DefaultResolver.LookupNetIP(ctx, network, host)
}

// ConnectorTTL is the lifetime of the answers a connector gives. Clients keep
// the routes they learn from them a little longer.
const ConnectorTTL = 60

// AnswerConnectorQuery answers a peer's query for a name under domains by
// looking it up here, and returns the addresses it answered with. Names
// outside domains are refused, so a connector is never an open resolver.
func AnswerConnectorQuery(ctx context.Context, query []byte, domains []string, lookup Lookup) (response []byte, learned []netip.Addr, err error) {
	var p dnsmessage.Parser
	header, err := p.Start(query)
	if err != nil {
		return nil, nil, err
	}
	if header.Response {
		return nil, nil, errors.New("not a query")
	}
	q, err := p.Question()
	if err != nil {
		resp, err := reply(header, nil, dnsmessage.RCodeFormatError, nil)
		return resp, nil, err
	}
	if header.OpCode != 0 {
		resp, err := reply(header, &q, dnsmessage.RCodeNotImplemented, nil)
		return resp, nil, err
	}
	name := strings.ToLower(strings.TrimSuffix(q.Name.String(), "."))
	if !MatchDomain(name, domains) {
		resp, err := reply(header, &q, dnsmessage.RCodeRefused, nil)
		return resp, nil, err
	}

	var network string
	switch q.Type {
	case dnsmessage.TypeA:
		network = "ip4"
	case dnsmessage.TypeAAAA:
		network = "ip6"
	default: // other types for a name we serve: nothing to say
		resp, err := reply(header, &q, dnsmessage.RCodeSuccess, nil)
		return resp, nil, err
	}
	addrs, lerr := lookup(ctx, network, name)
	if lerr != nil {
		var nf *net.DNSError
		if errors.As(lerr, &nf) && nf.IsNotFound {
			resp, err := reply(header, &q, dnsmessage.RCodeNameError, nil)
			return resp, nil, err
		}
		resp, err := reply(header, &q, dnsmessage.RCodeServerFailure, nil)
		return resp, nil, err
	}
	var answers []dnsmessage.Resource
	for _, a := range addrs {
		a = a.Unmap()
		rh := dnsmessage.ResourceHeader{Name: q.Name, Class: dnsmessage.ClassINET, TTL: ConnectorTTL}
		switch {
		case network == "ip4" && a.Is4():
			rh.Type = dnsmessage.TypeA
			answers = append(answers, dnsmessage.Resource{Header: rh, Body: &dnsmessage.AResource{A: a.As4()}})
		case network == "ip6" && a.Is6():
			rh.Type = dnsmessage.TypeAAAA
			answers = append(answers, dnsmessage.Resource{Header: rh, Body: &dnsmessage.AAAAResource{AAAA: a.As16()}})
		default:
			continue
		}
		learned = append(learned, a)
	}
	resp, err := reply(header, &q, dnsmessage.RCodeSuccess, answers)
	return resp, learned, err
}

// ResponseAddrs returns the addresses in a DNS response and the shortest TTL
// among them (seconds), for routing to what the connector resolved.
func ResponseAddrs(response []byte) (addrs []netip.Addr, minTTL uint32, ok bool) {
	var p dnsmessage.Parser
	h, err := p.Start(response)
	if err != nil || !h.Response || h.RCode != dnsmessage.RCodeSuccess {
		return nil, 0, false
	}
	if err := p.SkipAllQuestions(); err != nil {
		return nil, 0, false
	}
	minTTL = ^uint32(0)
	for {
		rh, err := p.AnswerHeader()
		if err != nil {
			break
		}
		switch rh.Type {
		case dnsmessage.TypeA:
			r, err := p.AResource()
			if err != nil {
				return nil, 0, false
			}
			addrs = append(addrs, netip.AddrFrom4(r.A))
		case dnsmessage.TypeAAAA:
			r, err := p.AAAAResource()
			if err != nil {
				return nil, 0, false
			}
			addrs = append(addrs, netip.AddrFrom16(r.AAAA))
		default:
			if err := p.SkipAnswer(); err != nil {
				return nil, 0, false
			}
			continue
		}
		minTTL = min(minTTL, rh.TTL)
	}
	if len(addrs) == 0 {
		return nil, 0, true
	}
	return addrs, minTTL, true
}

// Refused builds a REFUSED response to query, for forwarding that failed.
func Refused(query []byte) []byte {
	var p dnsmessage.Parser
	h, err := p.Start(query)
	if err != nil {
		return nil
	}
	q, qerr := p.Question()
	var qp *dnsmessage.Question
	if qerr == nil {
		qp = &q
	}
	resp, err := reply(h, qp, dnsmessage.RCodeServerFailure, nil)
	if err != nil {
		return nil
	}
	return resp
}
