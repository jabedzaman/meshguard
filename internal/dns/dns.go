// Package dns answers private mesh names: every device in the network
// resolves as <name>.internal (".internal" is reserved by ICANN for private
// use). The agent serves it on its mesh address and points the OS resolver at
// it for that domain only.
package dns

import (
	"context"
	"encoding/binary"
	"errors"
	"io"
	"log/slog"
	"net"
	"net/netip"
	"strings"
	"sync"
	"time"

	"golang.org/x/net/dns/dnsmessage"
)

// Domain is the zone the server answers, without the trailing dot.
const Domain = "internal"

// TTL of answers. Short: names follow devices that come and go.
const TTL = 30

// Record is one device's addresses. Either may be invalid (not assigned).
type Record struct {
	IPv4 netip.Addr
	IPv6 netip.Addr
}

// Server answers A and AAAA queries for <name>.internal from the records it
// was last given, NXDOMAIN for unknown names and REFUSED outside the zone.
type Server struct {
	mu      sync.RWMutex
	records map[string]Record
}

// SetRecords replaces the records, keyed by device name (a DNS label).
func (s *Server) SetRecords(records map[string]Record) {
	m := make(map[string]Record, len(records))
	for name, r := range records {
		m[strings.ToLower(name)] = r
	}
	s.mu.Lock()
	s.records = m
	s.mu.Unlock()
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
	label, inZone := strings.CutSuffix(name, "."+Domain)
	switch {
	case name == Domain:
		return reply(header, &q, dnsmessage.RCodeSuccess, nil)
	case !inZone:
		return reply(header, &q, dnsmessage.RCodeRefused, nil)
	}

	s.mu.RLock()
	r, ok := s.records[label]
	s.mu.RUnlock()
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

// Start answers on addr over UDP and TCP until ctx is done. It returns once
// both sockets are bound.
func (s *Server) Start(ctx context.Context, addr netip.AddrPort) error {
	pc, err := net.ListenUDP("udp", net.UDPAddrFromAddrPort(addr))
	if err != nil {
		return err
	}
	ln, err := net.ListenTCP("tcp", net.TCPAddrFromAddrPort(addr))
	if err != nil {
		pc.Close()
		return err
	}
	go func() {
		<-ctx.Done()
		pc.Close()
		ln.Close()
	}()
	go s.serveTCP(ln)
	go s.serveUDP(pc)
	return nil
}

func (s *Server) serveUDP(pc *net.UDPConn) {
	buf := make([]byte, 1500)
	for {
		n, from, err := pc.ReadFromUDPAddrPort(buf)
		if err != nil {
			if errors.Is(err, net.ErrClosed) {
				return
			}
			continue
		}
		res, err := s.Answer(buf[:n])
		if err != nil {
			continue
		}
		if _, err := pc.WriteToUDPAddrPort(res, from); err != nil {
			slog.Debug("dns reply failed", "to", from, "err", err)
		}
	}
}

func (s *Server) serveTCP(ln *net.TCPListener) {
	for {
		c, err := ln.Accept()
		if err != nil {
			if errors.Is(err, net.ErrClosed) {
				return
			}
			continue
		}
		go s.handleTCP(c)
	}
}

// handleTCP answers length-prefixed queries (RFC 1035 4.2.2) on one connection.
func (s *Server) handleTCP(c net.Conn) {
	defer c.Close()
	for {
		c.SetDeadline(time.Now().Add(10 * time.Second))
		var size [2]byte
		if _, err := io.ReadFull(c, size[:]); err != nil {
			return
		}
		query := make([]byte, binary.BigEndian.Uint16(size[:]))
		if _, err := io.ReadFull(c, query); err != nil {
			return
		}
		res, err := s.Answer(query)
		if err != nil {
			return
		}
		out := binary.BigEndian.AppendUint16(nil, uint16(len(res)))
		if _, err := c.Write(append(out, res...)); err != nil {
			return
		}
	}
}
