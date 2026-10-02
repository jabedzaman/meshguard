package relay

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/coder/websocket"
)

// Server forwards packets between connected clients by public key.
type Server struct {
	private [32]byte
	public  Key

	mu      sync.Mutex
	clients map[Key]*serverClient
}

type serverClient struct {
	key  Key
	out  chan []byte
	conn *websocket.Conn
}

// NewServer creates a relay with a fresh key, used only for handshakes.
func NewServer() (*Server, error) {
	s := &Server{clients: map[Key]*serverClient{}}
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

	key, err := s.handshake(ctx, conn)
	if err != nil {
		slog.Debug("relay handshake failed", "err", err)
		conn.Close(websocket.StatusPolicyViolation, "handshake failed")
		return
	}

	c := &serverClient{key: key, out: make(chan []byte, 256), conn: conn}
	s.register(c)
	defer s.unregister(c)

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
			continue
		}
		dst, packet, err := DecodeFrame(data)
		if err != nil {
			continue
		}
		s.forward(key, dst, packet)
	}
}

func (s *Server) handshake(ctx context.Context, conn *websocket.Conn) (Key, error) {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	var h hello
	if err := readJSON(ctx, conn, &h); err != nil {
		return Key{}, err
	}
	if len(h.PublicKey) != KeyLen {
		return Key{}, errInvalid
	}
	key := Key(h.PublicKey)

	nonce := make([]byte, 32)
	if _, err := rand.Read(nonce); err != nil {
		return Key{}, err
	}
	if err := writeJSON(ctx, conn, challenge{ServerKey: s.public[:], Challenge: nonce}); err != nil {
		return Key{}, err
	}
	var p proof
	if err := readJSON(ctx, conn, &p); err != nil {
		return Key{}, err
	}
	if !openProof(p, nonce, key, s.private) {
		return Key{}, errInvalid
	}
	return key, writeJSON(ctx, conn, welcome{})
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
