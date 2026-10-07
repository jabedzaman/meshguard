package relay

import (
	"context"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"sync"
	"time"

	"github.com/coder/websocket"

	"github.com/jabedzaman/meshguard/internal/netmark"
)

// markedHTTP dials with the agent's firewall mark, so the relay connection
// stays off an exit node's tunnel.
var markedHTTP = &http.Client{Transport: netmark.Transport()}

var (
	errInvalid      = errors.New("invalid relay message")
	errToken        = errors.New("relay token missing or invalid")
	errNotConnected = errors.New("relay not connected")
)

// Packet is a WireGuard packet received through the relay.
type Packet struct {
	From Key
	Data []byte
}

// Client keeps a connection to a relay, reconnecting with backoff.
type Client struct {
	URL     string
	private [32]byte
	public  Key
	// Deliver is called for every received packet. Set before Run.
	Deliver func(Packet)
	// OnStream is called, in its own goroutine, for each visitor the relay
	// carries to this agent (funnel), with a connection to them and their
	// address. The handler closes it. Set before Run; nil refuses visitors.
	OnStream func(conn net.Conn, remote string)
	// PingEvery is how often the connection is checked with a WebSocket
	// ping; a connection that doesn't answer is dropped and redialed, so a
	// half-open TCP connection (after sleep or a network change) doesn't
	// linger. Default 15s.
	PingEvery time.Duration

	kick chan struct{} // Reconnect: redial now, skipping the backoff

	mu    sync.Mutex
	conn  *websocket.Conn
	token string // see SetToken

	streams streamTable
}

// NewClient returns a client that authenticates as the WireGuard private key.
func NewClient(url string, private [32]byte) (*Client, error) {
	pub, err := PublicKey(private)
	if err != nil {
		return nil, err
	}
	return &Client{URL: url, private: private, public: pub, kick: make(chan struct{}, 1)}, nil
}

// Connected reports whether the client currently has a relay connection.
func (c *Client) Connected() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.conn != nil
}

// SetToken sets the control plane's relay token, sent when connecting and,
// when it changes, on the open connection so the relay keeps serving it.
func (c *Client) SetToken(token string) {
	c.mu.Lock()
	if token == c.token {
		c.mu.Unlock()
		return
	}
	c.token = token
	conn := c.conn
	c.mu.Unlock()
	if conn == nil || token == "" {
		return
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := writeJSON(ctx, conn, refresh{Token: token}); err != nil {
			slog.Debug("relay token refresh failed", "err", err)
		}
	}()
}

// Send forwards a packet to dst through the relay.
func (c *Client) Send(ctx context.Context, dst Key, packet []byte) error {
	c.mu.Lock()
	conn := c.conn
	c.mu.Unlock()
	if conn == nil {
		return errNotConnected
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	return conn.Write(ctx, websocket.MessageBinary, EncodeFrame(dst, packet))
}

// Reconnect drops the current connection and redials right away. Call it
// when the network changed: the old connection may be dead without an error.
func (c *Client) Reconnect() {
	select {
	case c.kick <- struct{}{}:
	default:
	}
	c.mu.Lock()
	conn := c.conn
	c.mu.Unlock()
	if conn != nil {
		conn.CloseNow()
	}
}

// Run connects and reads until ctx is done, reconnecting after failures.
func (c *Client) Run(ctx context.Context) {
	backoff := time.Second
	for ctx.Err() == nil {
		connected, err := c.session(ctx)
		if ctx.Err() != nil {
			return
		}
		if connected {
			backoff = time.Second // only consecutive failures back off
		}
		slog.Warn("relay disconnected", "url", c.URL, "err", err, "retry_in", backoff)
		select {
		case <-ctx.Done():
			return
		case <-c.kick:
		case <-time.After(backoff):
		}
		backoff = min(backoff*2, 30*time.Second)
	}
}

// session runs one connection. connected reports whether the handshake
// succeeded before it ended.
func (c *Client) session(ctx context.Context) (connected bool, err error) {
	dialCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	conn, _, err := websocket.Dial(dialCtx, c.URL, &websocket.DialOptions{HTTPClient: markedHTTP})
	cancel()
	if err != nil {
		return false, err
	}
	conn.SetReadLimit(KeyLen + MaxPacket + 1024)
	defer conn.CloseNow()

	sent, err := c.handshake(ctx, conn)
	if err != nil {
		return false, err
	}
	c.mu.Lock()
	c.conn = conn
	token := c.token
	c.mu.Unlock()
	if token != sent {
		// SetToken ran during the handshake, before there was a connection to send it on.
		_ = writeJSON(ctx, conn, refresh{Token: token})
	}
	defer func() {
		c.mu.Lock()
		c.conn = nil
		c.mu.Unlock()
		c.streams.closeAll()
	}()
	slog.Info("relay connected", "url", c.URL)

	sessionCtx, stop := context.WithCancel(ctx)
	defer stop()
	go c.keepalive(sessionCtx, conn)

	for {
		typ, data, err := conn.Read(ctx)
		if err != nil {
			return true, err
		}
		if typ != websocket.MessageBinary {
			continue
		}
		if IsStreamFrame(data) {
			if f, err := DecodeStreamFrame(data); err == nil {
				c.streamFrame(ctx, conn, f)
			}
			continue
		}
		from, packet, err := DecodeFrame(data)
		if err != nil {
			continue
		}
		if c.Deliver != nil {
			c.Deliver(Packet{From: from, Data: packet})
		}
	}
}

// keepalive pings until ctx is done and drops the connection if a ping goes
// unanswered. Pongs are read by the session's read loop.
func (c *Client) keepalive(ctx context.Context, conn *websocket.Conn) {
	every := c.PingEvery
	if every == 0 {
		every = 15 * time.Second
	}
	ticker := time.NewTicker(every)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
		pingCtx, cancel := context.WithTimeout(ctx, min(every, 5*time.Second))
		err := conn.Ping(pingCtx)
		cancel()
		if err != nil && ctx.Err() == nil {
			slog.Warn("relay ping failed", "url", c.URL, "err", err)
			conn.CloseNow()
			return
		}
	}
}

// handshake authenticates to the relay and returns the token it sent.
func (c *Client) handshake(ctx context.Context, conn *websocket.Conn) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	c.mu.Lock()
	token := c.token
	c.mu.Unlock()
	if err := writeJSON(ctx, conn, hello{PublicKey: c.public[:], Token: token}); err != nil {
		return "", err
	}
	var ch challenge
	if err := readJSON(ctx, conn, &ch); err != nil {
		return "", err
	}
	if len(ch.ServerKey) != KeyLen {
		return "", errInvalid
	}
	p, err := sealProof(ch.Challenge, Key(ch.ServerKey), c.private)
	if err != nil {
		return "", err
	}
	if err := writeJSON(ctx, conn, p); err != nil {
		return "", err
	}
	var w welcome
	return token, readJSON(ctx, conn, &w)
}
