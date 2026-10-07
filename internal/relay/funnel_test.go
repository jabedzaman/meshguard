package relay

import (
	"bufio"
	"context"
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"fmt"
	"io"
	"math/big"
	"net"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const funnelName = "laptop.brave-otter.mesh.example.com"

// testCert is a self-signed certificate for names.
func testCert(t *testing.T, names ...string) (tls.Certificate, *x509.CertPool) {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	require.NoError(t, err)
	tmpl := &x509.Certificate{
		SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: names[0]}, DNSNames: names,
		NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour),
		KeyUsage: x509.KeyUsageDigitalSignature | x509.KeyUsageCertSign, BasicConstraintsValid: true, IsCA: true,
		ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &key.PublicKey, key)
	require.NoError(t, err)
	leaf, err := x509.ParseCertificate(der)
	require.NoError(t, err)
	pool := x509.NewCertPool()
	pool.AddCert(leaf)
	return tls.Certificate{Certificate: [][]byte{der}, PrivateKey: key}, pool
}

// funnelAgent connects a client allowed to serve names that terminates TLS and
// answers HTTP with `body`.
func funnelAgent(t *testing.T, ctx context.Context, url string, signer ed25519.PrivateKey, body string, names ...string) (*Client, *x509.CertPool) {
	t.Helper()
	priv := newKey(t)
	pub, _ := PublicKey(priv)
	c, err := NewClient(url, priv)
	require.NoError(t, err)
	c.SetToken(SignToken(signer, pub, time.Now().Add(time.Hour), names...))
	cert, pool := testCert(t, names...)
	c.OnStream = func(conn net.Conn, _ string) {
		defer conn.Close()
		tlsConn := tls.Server(conn, &tls.Config{Certificates: []tls.Certificate{cert}})
		if tlsConn.Handshake() != nil {
			return
		}
		// Answer one HTTP/1.1 request, with a body big enough to need several frames.
		req, err := http.ReadRequest(bufio.NewReader(tlsConn))
		if err != nil {
			return
		}
		payload := body + " " + req.Host + " " + strings.Repeat("x", 3*MaxStreamData)
		fmt.Fprintf(tlsConn, "HTTP/1.1 200 OK\r\nContent-Length: %d\r\nConnection: close\r\n\r\n%s", len(payload), payload)
	}
	go c.Run(ctx)
	require.Eventually(t, c.Connected, 3*time.Second, 10*time.Millisecond)
	return c, pool
}

func startFunnel(t *testing.T, ctx context.Context, srv *Server) string {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	go srv.ServeFunnel(ctx, ln)
	return ln.Addr().String()
}

func visit(t *testing.T, addr, name string, roots *x509.CertPool) (string, error) {
	t.Helper()
	client := &http.Client{
		Timeout: 5 * time.Second,
		Transport: &http.Transport{
			DialContext: func(ctx context.Context, network, _ string) (net.Conn, error) {
				return (&net.Dialer{}).DialContext(ctx, network, addr)
			},
			TLSClientConfig:   &tls.Config{RootCAs: roots, ServerName: name},
			DisableKeepAlives: true,
		},
	}
	res, err := client.Get("https://" + name + "/hello")
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	body, err := io.ReadAll(res.Body)
	return string(body), err
}

func TestFunnelCarriesVisitorsToTheAgentThatMayServeTheName(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	srv, url, signer := startTrustedRelay(t)
	_, laptopPool := funnelAgent(t, ctx, url, signer, "laptop", funnelName)
	_, serverPool := funnelAgent(t, ctx, url, signer, "server", "server."+funnelName)
	addr := startFunnel(t, ctx, srv)
	require.Eventually(t, func() bool {
		srv.mu.Lock()
		defer srv.mu.Unlock()
		return len(srv.hostnames) == 2
	}, 2*time.Second, 10*time.Millisecond)

	// Each visitor reaches the agent for the name it asked for, and the TLS
	// session is with that agent: its certificate is the one that verifies.
	body, err := visit(t, addr, funnelName, laptopPool)
	require.NoError(t, err)
	assert.True(t, strings.HasPrefix(body, "laptop "+funnelName+" x"), body[:60])
	assert.Len(t, body, len("laptop "+funnelName+" ")+3*MaxStreamData, "a response of several frames arrives whole")
	body, err = visit(t, addr, "server."+funnelName, serverPool)
	require.NoError(t, err)
	assert.True(t, strings.HasPrefix(body, "server server."+funnelName+" x"))
	_, err = visit(t, addr, funnelName, serverPool)
	assert.Error(t, err, "the other agent's certificate doesn't verify")

	assert.Eventually(t, func() bool { return srv.Streams() == 0 }, 2*time.Second, 20*time.Millisecond, "streams are cleaned up")
}

func TestFunnelRefusesNamesNoAgentMayServe(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	srv, url, signer := startTrustedRelay(t)
	funnelAgent(t, ctx, url, signer, "hi", funnelName)
	addr := startFunnel(t, ctx, srv)
	require.Eventually(t, func() bool {
		srv.mu.Lock()
		defer srv.mu.Unlock()
		return srv.hostnames[funnelName] != nil
	}, 2*time.Second, 10*time.Millisecond)

	_, roots := testCert(t, "other.example.com")
	_, err := visit(t, addr, "other.example.com", roots)
	assert.Error(t, err, "no agent serves it")

	// Not TLS at all, and TLS without a name.
	conn, err := net.Dial("tcp", addr)
	require.NoError(t, err)
	_, _ = conn.Write([]byte("GET / HTTP/1.1\r\n\r\n"))
	_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	n, _ := conn.Read(make([]byte, 16))
	assert.Zero(t, n, "closed without an answer")
	conn.Close()
	assert.Zero(t, srv.Streams())
}

func TestFunnelEndsWhenTheAgentLeavesAndNamesGoWithIt(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	srv, url, signer := startTrustedRelay(t)
	agentCtx, stop := context.WithCancel(ctx)
	funnelAgent(t, agentCtx, url, signer, "hi", funnelName)
	require.Eventually(t, func() bool {
		srv.mu.Lock()
		defer srv.mu.Unlock()
		return srv.hostnames[funnelName] != nil
	}, 2*time.Second, 10*time.Millisecond)

	stop()
	require.Eventually(t, func() bool {
		srv.mu.Lock()
		defer srv.mu.Unlock()
		return len(srv.hostnames) == 0
	}, 3*time.Second, 20*time.Millisecond)
}

func TestFunnelStreamFrames(t *testing.T) {
	f := StreamFrame{Type: FrameData, ID: 42, Data: []byte("bytes")}
	msg := EncodeStreamFrame(f)
	require.True(t, IsStreamFrame(msg))
	got, err := DecodeStreamFrame(msg)
	require.NoError(t, err)
	assert.Equal(t, f, got)

	// A WireGuard frame (any real key) is not a stream frame.
	var k Key
	k[3] = 9
	assert.False(t, IsStreamFrame(EncodeFrame(k, []byte("packet payload"))))
	bad := EncodeStreamFrame(StreamFrame{Type: 9, ID: 1})
	_, err = DecodeStreamFrame(bad)
	assert.Error(t, err, "unknown type")
}

func TestReadServerName(t *testing.T) {
	client, server := net.Pipe()
	defer client.Close()
	go func() {
		c := tls.Client(client, &tls.Config{ServerName: "Laptop.Example.COM", InsecureSkipVerify: true})
		_ = c.Handshake()
	}()
	name, hello, err := readServerName(server)
	server.Close()
	require.NoError(t, err)
	assert.Equal(t, "laptop.example.com", name, "lower case")
	assert.True(t, len(hello) > 50 && hello[0] == 0x16, "the TLS record to replay")
}
