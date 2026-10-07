package relay

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/json"
	"log/slog"
	"net/http"
	"sync"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"
)

// Server forwards packets between connected clients by public key.
type Server struct {
	// Trust is the control plane's relay token key. When set, only clients
	// with a valid token for their key are served, until it expires.
	Trust ed25519.PublicKey

	private [32]byte
	public  Key

	mu      sync.Mutex
	clients map[Key]*serverClient
	// hostnames maps the public names agents may serve (from their tokens) to them.
	hostnames   map[string]*serverClient
	streamCount int
}

type serverClient struct {
	key  Key
	out  chan []byte
	conn *websocket.Conn
	// expires is the token's expiry (unix seconds); unused without Trust.
	expires atomic.Int64
	// ctx ends with the connection.
	ctx context.Context
	// streams are the visitors being carried to this agent (guarded by Server.mu).
	streams    map[uint32]*funnelStream
	nextStream uint32
}

// NewServer creates a relay with a fresh key, used only for handshakes.
func NewServer() (*Server, error) {
	s := &Server{clients: map[Key]*serverClient{}, hostnames: map[string]*serverClient{}}
	if _, err := rand.Read(s.private[:]); err != nil {
		return nil, err
	}
	pub, err := PublicKey(s.private)
	if err != nil {
		return nil, err
	}
	s.public = pub
	return s, nil
}

// Clients returns the number of connected clients.
func (s *Server) Clients() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.clients)
}

// ServeHTTP upgrades to WebSocket and runs one client connection.
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	conn, err := websocket.Accept(w, r, nil)
	if err != nil {
		return
	}
	conn.SetReadLimit(KeyLen + MaxPacket + 1024)
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	defer conn.CloseNow()

	key, claims, err := s.handshake(ctx, conn)
	if err != nil {
		slog.Debug("relay handshake failed", "err", err)
		reason := "handshake failed"
		if err == errToken {
			reason = "relay token missing or invalid"
		}
		conn.Close(websocket.StatusPolicyViolation, reason)
		return
	}

	c := &serverClient{key: key, out: make(chan []byte, 256), conn: conn, ctx: ctx, streams: map[uint32]*funnelStream{}}
	c.expires.Store(claims.Expires.Unix())
	s.register(c)
	defer s.unregister(c)
	defer s.dropStreams(c)
	if len(claims.Hostnames) > 0 {
		s.setHostnames(c, claims.Hostnames)
	}
	if s.Trust != nil {
		go s.expire(ctx, cancel, c)
	}

	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			case frame := <-c.out:
				writeCtx, done := context.WithTimeout(ctx, 10*time.Second)
				err := conn.Write(writeCtx, websocket.MessageBinary, frame)
				done()
				if err != nil {
					cancel()
					return
				}
			}
		}
	}()

	for {
		typ, data, err := conn.Read(ctx)
		if err != nil {
			return
		}
		if typ != websocket.MessageBinary {
			s.refresh(c, data)
			continue
		}
		if IsStreamFrame(data) {
			if f, err := DecodeStreamFrame(data); err == nil {
				s.streamFrame(c, f)
			}
			continue
		}
		dst, packet, err := DecodeFrame(data)
		if err != nil {
			continue
		}
		s.forward(key, dst, packet)
	}
}

// refresh takes a fresh token from an open connection; invalid ones are ignored.
func (s *Server) refresh(c *serverClient, data []byte) {
	var r refresh
	if s.Trust == nil || json.Unmarshal(data, &r) != nil {
		return
	}
	// The same expiry still counts: tokens expire at period boundaries, so a
	// change of public names within one period carries the period's expiry.
	if claims, ok := VerifyTokenClaims(s.Trust, r.Token, c.key, time.Now()); ok && claims.Expires.Unix() >= c.expires.Load() {
		c.expires.Store(claims.Expires.Unix())
		s.setHostnames(c, claims.Hostnames)
	}
}

// expire closes c's connection once its token expires without a refresh.
func (s *Server) expire(ctx context.Context, cancel context.CancelFunc, c *serverClient) {
	for {
		wait := time.Until(time.Unix(c.expires.Load(), 0))
		if wait <= 0 {
			slog.Debug("relay token expired", "key", c.key)
			c.conn.Close(websocket.StatusPolicyViolation, "relay token expired")
			cancel()
			return
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(wait):
		}
	}
}

// handshake authenticates a client: it proves it holds its key's private
// key, and with Trust set, that the control plane let it use the relay (the
// token's expiry is returned).
func (s *Server) handshake(ctx context.Context, conn *websocket.Conn) (Key, Claims, error) {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	var h hello
	if err := readJSON(ctx, conn, &h); err != nil {
		return Key{}, Claims{}, err
	}
	if len(h.PublicKey) != KeyLen {
		return Key{}, Claims{}, errInvalid
	}
	key := Key(h.PublicKey)
	var claims Claims
	if s.Trust != nil {
		verified, ok := VerifyTokenClaims(s.Trust, h.Token, key, time.Now())
		if !ok {
			return Key{}, Claims{}, errToken
		}
		claims = verified
	}

	nonce := make([]byte, 32)
	if _, err := rand.Read(nonce); err != nil {
		return Key{}, Claims{}, err
	}
	if err := writeJSON(ctx, conn, challenge{ServerKey: s.public[:], Challenge: nonce}); err != nil {
		return Key{}, Claims{}, err
	}
	var p proof
	if err := readJSON(ctx, conn, &p); err != nil {
		return Key{}, Claims{}, err
	}
	if !openProof(p, nonce, key, s.private) {
		return Key{}, Claims{}, errInvalid
	}
	return key, claims, writeJSON(ctx, conn, welcome{})
}

func (s *Server) register(c *serverClient) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if old, ok := s.clients[c.key]; ok {
		// Newest connection for a key wins (e.g. the agent reconnected).
		old.conn.Close(websocket.StatusGoingAway, "replaced by a newer connection")
	}
	s.clients[c.key] = c
}

func (s *Server) unregister(c *serverClient) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.clients[c.key] == c {
		delete(s.clients, c.key)
	}
	for name, owner := range s.hostnames {
		if owner == c {
			delete(s.hostnames, name)
		}
	}
}

func (s *Server) forward(src, dst Key, packet []byte) {
	s.mu.Lock()
	c, ok := s.clients[dst]
	s.mu.Unlock()
	if !ok {
		return // peer not connected; WireGuard retries
	}
	select {
	case c.out <- EncodeFrame(src, packet):
	default: // slow receiver: drop, like a congested UDP path
	}
}

func readJSON(ctx context.Context, conn *websocket.Conn, v any) error {
	typ, data, err := conn.Read(ctx)
	if err != nil {
		return err
	}
	if typ != websocket.MessageText {
		return errInvalid
	}
	return json.Unmarshal(data, v)
}

func writeJSON(ctx context.Context, conn *websocket.Conn, v any) error {
	data, err := json.Marshal(v)
	if err != nil {
		return err
	}
	return conn.Write(ctx, websocket.MessageText, data)
}
