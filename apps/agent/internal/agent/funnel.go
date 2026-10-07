package agent

import (
	"context"
	"crypto/tls"
	"log/slog"
	"net"
	"strconv"
	"time"

	"github.com/jabedzaman/meshguard/internal/dns"
	"github.com/jabedzaman/meshguard/internal/ipc"
)

// Funnel: the internet reaches a local port through the relay. An owner or
// admin turns the device's funnel on in the web (the relay then lets this
// device serve its mesh name), and the user picks the port with
// `meshguard funnel <port>`. Visitors' TLS arrives untouched on the relay
// connection; the agent ends it with the device's certificate (see cert.go)
// and passes plain bytes to the local port.

const (
	funnelHandshakeTimeout = 10 * time.Second
	funnelCertRetry        = time.Minute
)

// funnelState is one connection's funnel. Guarded by Agent.mu.
type funnelState struct {
	// allowed: an owner or admin turned the device's funnel on (network map).
	allowed bool
	name    string
	cert    *tls.Certificate
	// fetching: a goroutine is getting the certificate.
	fetching bool
	problem  string
}

// funnelDesired reports whether the funnel should be serving. Caller holds a.mu.
func (c *connection) funnelDesired() bool {
	return c.funnel.allowed && c.prefs.FunnelPort > 0 && c.relayClient != nil
}

// updateFunnelLocked applies the network map's funnel setting and starts
// getting a certificate when one is needed. Caller holds a.mu.
func (a *Agent) updateFunnelLocked(c *connection, allowed bool) {
	c.funnel.allowed = allowed
	if c.dns.domain != "" {
		c.funnel.name = dns.Name(c.dns.name, c.dns.domain)
	}
	a.ensureFunnelCertLocked(c)
}

// ensureFunnelCertLocked fetches the certificate in the background when the
// funnel is wanted and there is none, or the one held is due for renewal.
func (a *Agent) ensureFunnelCertLocked(c *connection) {
	if !c.funnelDesired() || c.funnel.fetching {
		return
	}
	if cert := c.funnel.cert; cert != nil && !certDue(cert, time.Now()) {
		return
	}
	c.funnel.fetching = true
	go func() {
		for c.ctx.Err() == nil {
			cert, err := a.getCert(c.ctx, false)
			a.mu.Lock()
			if err == nil {
				pair, perr := tls.X509KeyPair([]byte(cert.Certificate), []byte(cert.Key))
				if perr == nil {
					c.funnel.cert, c.funnel.problem, c.funnel.fetching = &pair, "", false
					a.mu.Unlock()
					slog.Info("funnel certificate ready", "name", cert.Name, "until", cert.NotAfter)
					return
				}
				err = perr
			}
			c.funnel.problem = "no certificate yet: " + err.Error()
			wanted := c.funnelDesired()
			if !wanted {
				c.funnel.fetching = false
			}
			a.mu.Unlock()
			if !wanted {
				return
			}
			slog.Warn("funnel certificate", "err", err)
			select {
			case <-c.ctx.Done():
				return
			case <-time.After(funnelCertRetry):
			}
		}
	}()
}

// funnelCertificate is the TLS config's certificate lookup.
func (a *Agent) funnelCertificate(c *connection) func(*tls.ClientHelloInfo) (*tls.Certificate, error) {
	return func(*tls.ClientHelloInfo) (*tls.Certificate, error) {
		a.mu.Lock()
		defer a.mu.Unlock()
		if c.funnel.cert == nil {
			return nil, context.DeadlineExceeded
		}
		return c.funnel.cert, nil
	}
}

// handleFunnelStream serves one visitor the relay carried to this device.
func (a *Agent) handleFunnelStream(c *connection, conn net.Conn, remote string) {
	defer conn.Close()
	a.mu.Lock()
	port := c.prefs.FunnelPort
	live := c.funnelDesired() && c.funnel.cert != nil
	a.mu.Unlock()
	if !live {
		return
	}
	_ = conn.SetDeadline(time.Now().Add(funnelHandshakeTimeout))
	secured := tls.Server(conn, &tls.Config{
		GetCertificate: a.funnelCertificate(c),
		MinVersion:     tls.VersionTLS12,
		NextProtos:     []string{"http/1.1"},
	})
	if err := secured.Handshake(); err != nil {
		slog.Debug("funnel handshake", "remote", remote, "err", err)
		return
	}
	_ = conn.SetDeadline(time.Time{})
	slog.Debug("funnel visitor", "remote", remote, "port", port)
	proxy(secured, net.JoinHostPort("127.0.0.1", strconv.Itoa(port)))
}

// funnelStatusLocked describes the funnel for status. Caller holds a.mu.
func (c *connection) funnelStatusLocked() *ipc.FunnelStatus {
	s := &ipc.FunnelStatus{Name: c.funnel.name, Allowed: c.funnel.allowed, Port: c.prefs.FunnelPort, Problem: c.funnel.problem}
	switch {
	case !c.funnel.allowed && c.prefs.FunnelPort == 0:
		return nil
	case c.prefs.FunnelPort == 0:
		s.State = "no port chosen"
	case !c.funnel.allowed:
		s.State = "waiting for an owner or admin to turn it on"
	case c.funnel.cert == nil:
		s.State = "waiting for a certificate"
	default:
		s.State = "live"
	}
	return s
}

// certDue reports whether a held certificate should be replaced: a third of
// its life left or less (see loadSavedCert).
func certDue(c *tls.Certificate, now time.Time) bool {
	leaf := c.Leaf
	if leaf == nil && len(c.Certificate) > 0 {
		pair, err := parseLeaf(c.Certificate[0])
		if err != nil {
			return true
		}
		leaf = pair
	}
	if leaf == nil {
		return true
	}
	renewAt := leaf.NotAfter.Add(-leaf.NotAfter.Sub(leaf.NotBefore) / certRenewFraction)
	return !now.Before(renewAt)
}
