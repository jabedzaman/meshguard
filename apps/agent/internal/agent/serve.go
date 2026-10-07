package agent

import (
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/netip"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/jabedzaman/meshguard/internal/ipc"
	"github.com/jabedzaman/meshguard/internal/state"
)

// serveManager shares local TCP services with the mesh: it listens on the
// device's mesh addresses, so peers reach a service that only listens on
// 127.0.0.1, and proxies each connection to it. Access rules apply as for
// any traffic from peers, since the connections arrive through the TUN.
type serveManager struct {
	// mesh addresses to listen on.
	addrs []netip.Addr

	mu    sync.Mutex
	rules map[int]*serving
}

type serving struct {
	rule      state.ServeRule
	listeners []net.Listener
	err       string
}

func newServeManager(addrs []netip.Addr) *serveManager {
	return &serveManager{addrs: addrs, rules: map[int]*serving{}}
}

// parseServeTarget turns "3000", ":3000" or "localhost:3000" into a loopback
// "host:port"; anything else is refused, since a shared service must not turn
// the device into a relay to other machines.
func parseServeTarget(target string) (string, error) {
	target = strings.TrimSpace(target)
	host, port, err := net.SplitHostPort(target)
	if err != nil {
		host, port = "", target
	}
	if n, perr := strconv.Atoi(port); perr != nil || n < 1 || n > 65535 {
		return "", fmt.Errorf("%q isn't a port", port)
	}
	switch host {
	case "", "localhost":
		host = "127.0.0.1"
	default:
		ip, perr := netip.ParseAddr(host)
		if perr != nil || !ip.IsLoopback() {
			return "", fmt.Errorf("a shared service must be on this machine (localhost or 127.0.0.1), not %s", host)
		}
	}
	return net.JoinHostPort(host, port), nil
}

// validateServe checks rules from the CLI and returns them in canonical form.
func validateServe(rules []ipc.ServeRule) ([]state.ServeRule, error) {
	seen := map[int]bool{}
	out := []state.ServeRule{}
	for _, r := range rules {
		if r.Port < 1 || r.Port > 65535 {
			return nil, fmt.Errorf("port %d is out of range", r.Port)
		}
		if seen[r.Port] {
			return nil, fmt.Errorf("port %d is shared twice", r.Port)
		}
		seen[r.Port] = true
		target, err := parseServeTarget(r.Target)
		if err != nil {
			return nil, err
		}
		out = append(out, state.ServeRule{Port: r.Port, Target: target})
	}
	slices.SortFunc(out, func(a, b state.ServeRule) int { return a.Port - b.Port })
	return out, nil
}

// set makes the listeners match rules, starting and stopping only what changed.
func (m *serveManager) set(rules []state.ServeRule) {
	m.mu.Lock()
	defer m.mu.Unlock()
	want := map[int]state.ServeRule{}
	for _, r := range rules {
		want[r.Port] = r
	}
	for port, s := range m.rules {
		if r, ok := want[port]; !ok || r != s.rule {
			s.close()
			delete(m.rules, port)
		}
	}
	for port, r := range want {
		if _, ok := m.rules[port]; !ok {
			m.rules[port] = m.start(r)
		}
	}
}

func (m *serveManager) start(r state.ServeRule) *serving {
	s := &serving{rule: r}
	var errs []string
	for _, addr := range m.addrs {
		network := "tcp4"
		if addr.Is6() {
			network = "tcp6"
		}
		ln, err := net.Listen(network, net.JoinHostPort(addr.String(), strconv.Itoa(r.Port)))
		if err != nil {
			errs = append(errs, err.Error())
			continue
		}
		s.listeners = append(s.listeners, ln)
		go proxyAccepted(ln, r.Target)
	}
	if len(s.listeners) == 0 {
		s.err = strings.Join(errs, "; ")
		slog.Warn("cannot share port", "port", r.Port, "err", s.err)
	} else {
		slog.Info("sharing local service", "port", r.Port, "target", r.Target)
	}
	return s
}

func (s *serving) close() {
	for _, ln := range s.listeners {
		ln.Close()
	}
}

// close stops everything.
func (m *serveManager) close() { m.set(nil) }

// status lists the shared services with why one isn't listening.
func (m *serveManager) status() []ipc.ServeRule {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]ipc.ServeRule, 0, len(m.rules))
	for _, s := range m.rules {
		out = append(out, ipc.ServeRule{Port: s.rule.Port, Target: s.rule.Target, Error: s.err})
	}
	slices.SortFunc(out, func(a, b ipc.ServeRule) int { return a.Port - b.Port })
	return out
}

func proxyAccepted(ln net.Listener, target string) {
	for {
		conn, err := ln.Accept()
		if err != nil {
			if !errors.Is(err, net.ErrClosed) {
				slog.Debug("serve accept", "err", err)
			}
			return
		}
		go proxy(conn, target)
	}
}

func proxy(client net.Conn, target string) {
	defer client.Close()
	upstream, err := net.DialTimeout("tcp", target, 5*time.Second)
	if err != nil {
		return
	}
	defer upstream.Close()
	done := make(chan struct{}, 2)
	pipe := func(dst, src net.Conn) {
		_, _ = io.Copy(dst, src)
		if c, ok := dst.(interface{ CloseWrite() error }); ok {
			_ = c.CloseWrite() // tell the other side we're done, keep reading its reply
		}
		done <- struct{}{}
	}
	go pipe(upstream, client)
	go pipe(client, upstream)
	<-done
	<-done
}

// startServeLocked shares the saved local services on the mesh addresses.
// Caller holds a.mu and WireGuard is up (so the addresses exist).
func (a *Agent) startServeLocked(c *connection, st *state.State) {
	var addrs []netip.Addr
	for _, raw := range []string{st.Device.MeshIPv4, st.Device.MeshIPv6} {
		if ip, err := netip.ParseAddr(raw); err == nil {
			addrs = append(addrs, ip)
		}
	}
	c.serve = newServeManager(addrs)
	c.serve.set(st.Prefs.Serve)
}
