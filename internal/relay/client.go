package relay

import (
	"context"
	"errors"
	"log/slog"
	"sync"
	"time"

	"github.com/coder/websocket"
)

var (
	errInvalid      = errors.New("invalid relay message")
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

	mu   sync.Mutex
	conn *websocket.Conn
}

// NewClient returns a client that authenticates as the WireGuard private key.
func NewClient(url string, private [32]byte) (*Client, error) {
	pub, err := PublicKey(private)
	if err != nil {
		return nil, err
	}
	return &Client{URL: url, private: private, public: pub}, nil
}

// Connected reports whether the client currently has a relay connection.
func (c *Client) Connected() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.conn != nil
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

// Run connects and reads until ctx is done, reconnecting after failures.
func (c *Client) Run(ctx context.Context) {
	backoff := time.Second
	for ctx.Err() == nil {
		err := c.session(ctx)
		if ctx.Err() != nil {
			return
		}
		slog.Warn("relay disconnected", "url", c.URL, "err", err, "retry_in", backoff)
		select {
		case <-ctx.Done():
			return
		case <-time.After(backoff):
		}
		backoff = min(backoff*2, 30*time.Second)
	}
}

func (c *Client) session(ctx context.Context) error {
	dialCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	conn, _, err := websocket.Dial(dialCtx, c.URL, nil)
	cancel()
	if err != nil {
		return err
	}
	conn.SetReadLimit(KeyLen + MaxPacket + 1024)
	defer conn.CloseNow()

	if err := c.handshake(ctx, conn); err != nil {
		return err
	}
	c.mu.Lock()
	c.conn = conn
	c.mu.Unlock()
	defer func() {
		c.mu.Lock()
		c.conn = nil
		c.mu.Unlock()
	}()
	slog.Info("relay connected", "url", c.URL)

	for {
		typ, data, err := conn.Read(ctx)
		if err != nil {
			return err
		}
		if typ != websocket.MessageBinary {
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

func (c *Client) handshake(ctx context.Context, conn *websocket.Conn) error {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	if err := writeJSON(ctx, conn, hello{PublicKey: c.public[:]}); err != nil {
		return err
	}
	var ch challenge
	if err := readJSON(ctx, conn, &ch); err != nil {
		return err
	}
	if len(ch.ServerKey) != KeyLen {
		return errInvalid
	}
	p, err := sealProof(ch.Challenge, Key(ch.ServerKey), c.private)
	if err != nil {
		return err
	}
	if err := writeJSON(ctx, conn, p); err != nil {
		return err
	}
	var w welcome
	return readJSON(ctx, conn, &w)
}
