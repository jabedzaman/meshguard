package relay

import (
	"context"
	"crypto/tls"
	"errors"
	"io"
	"log/slog"
	"net"
	"strings"
	"sync"
	"time"
)

const (
	// maxHelloBytes bounds the TLS ClientHello read to find the name asked for.
	maxHelloBytes = 20 * 1024
	helloTimeout  = 10 * time.Second
	// MaxStreamsPerClient bounds the visitors one agent serves at once.
	MaxStreamsPerClient = 256
	// MaxStreams bounds the visitors the relay carries at once.
	MaxStreams = 4096
	// streamQueue is how many frames may wait for a slow visitor or agent
	// before that stream is dropped, so one slow stream can't stall the rest.
	streamQueue = 64
	// streamSendTimeout is how long to wait to queue a frame for an agent.
	streamSendTimeout = 5 * time.Second
	// visitorIdle closes streams nobody has used for this long.
	visitorIdle = 5 * time.Minute
)

// A funnelStream is one visitor's TCP connection carried to an agent.
type funnelStream struct {
	id     uint32
	conn   net.Conn
	client *serverClient
	// toVisitor holds what the agent sent, written by one goroutine so a slow
	// visitor can't hold up the agent's other traffic.
	toVisitor chan []byte
	once      sync.Once
	done      chan struct{}
}

func (st *funnelStream) close() {
	st.once.Do(func() {
		close(st.done)
		st.conn.Close()
	})
}

// Streams reports how many visitor connections are being carried.
func (s *Server) Streams() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.streamCount
}

// setHostnames makes c the agent for exactly these public names (lower case).
// A name moves to the newest agent that claims it, like a key does.
func (s *Server) setHostnames(c *serverClient, names []string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for name, owner := range s.hostnames {
		if owner == c {
			delete(s.hostnames, name)
		}
	}
	for _, name := range names {
		s.hostnames[name] = c
	}
}

// ServeFunnel accepts visitors on ln until it fails or ctx ends. Each one's
// TLS ClientHello is read only to find the name it asks for; its bytes then
// go, untouched, over the relay connection of the agent allowed to serve that
// name. The relay never holds a certificate or sees plaintext.
func (s *Server) ServeFunnel(ctx context.Context, ln net.Listener) error {
	go func() {
		<-ctx.Done()
		ln.Close()
	}()
	for {
		conn, err := ln.Accept()
		if err != nil {
			if ctx.Err() != nil || errors.Is(err, net.ErrClosed) {
				return nil
			}
			return err
		}
		go s.serveVisitor(ctx, conn)
	}
}

func (s *Server) serveVisitor(ctx context.Context, conn net.Conn) {
	name, hello, err := readServerName(conn)
	if err != nil {
		slog.Debug("funnel: no server name", "remote", conn.RemoteAddr(), "err", err)
		conn.Close()
		return
	}
	st, ok := s.openStream(conn, name)
	if !ok {
		conn.Close()
		return
	}
	defer s.closeStream(st)

	if !st.client.send(ctx, EncodeStreamFrame(StreamFrame{Type: FrameOpen, ID: st.id, Data: []byte(conn.RemoteAddr().String())})) {
		return
	}
	// The ClientHello goes first, in frames of the same size as the rest.
	for chunk := range chunks(hello, MaxStreamData) {
		if !st.client.send(ctx, EncodeStreamFrame(StreamFrame{Type: FrameData, ID: st.id, Data: chunk})) {
			return
		}
	}

	go st.writeToVisitor()
	buf := make([]byte, MaxStreamData)
	for {
		_ = conn.SetReadDeadline(time.Now().Add(visitorIdle))
		n, err := conn.Read(buf)
		if n > 0 {
			frame := EncodeStreamFrame(StreamFrame{Type: FrameData, ID: st.id, Data: buf[:n]})
			if !st.client.send(ctx, frame) {
				return
			}
		}
		if err != nil {
			st.client.send(ctx, EncodeStreamFrame(StreamFrame{Type: FrameClose, ID: st.id}))
			return
		}
	}
}

// writeToVisitor sends what the agent returned to the visitor.
func (st *funnelStream) writeToVisitor() {
	for {
		select {
		case data := <-st.toVisitor:
			if data == nil { // the agent is done: everything before it has been written
				st.close()
				return
			}
			_ = st.conn.SetWriteDeadline(time.Now().Add(30 * time.Second))
			if _, err := st.conn.Write(data); err != nil {
				st.close()
				return
			}
		case <-st.done:
			return
		}
	}
}

// openStream registers a stream to the agent serving name, within the limits.
func (s *Server) openStream(conn net.Conn, name string) (*funnelStream, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	c, ok := s.hostnames[name]
	if !ok || s.streamCount >= MaxStreams || len(c.streams) >= MaxStreamsPerClient {
		return nil, false
	}
	c.nextStream++
	st := &funnelStream{
		id: c.nextStream, conn: conn, client: c,
		toVisitor: make(chan []byte, streamQueue), done: make(chan struct{}),
	}
	c.streams[st.id] = st
	s.streamCount++
	return st, true
}

func (s *Server) closeStream(st *funnelStream) {
	st.close()
	s.mu.Lock()
	defer s.mu.Unlock()
	if st.client.streams[st.id] == st {
		delete(st.client.streams, st.id)
		s.streamCount--
	}
}

// streamFrame handles a stream frame from an agent.
func (s *Server) streamFrame(c *serverClient, f StreamFrame) {
	s.mu.Lock()
	st := c.streams[f.ID]
	s.mu.Unlock()
	if st == nil {
		return
	}
	switch f.Type {
	case FrameData:
		select {
		case st.toVisitor <- append([]byte(nil), f.Data...):
		default: // the visitor can't keep up
			st.close()
		}
	case FrameClose:
		// Queue the end after what the agent already sent, so the visitor gets all of it.
		select {
		case st.toVisitor <- nil:
		default:
			st.close()
		}
	}
}

// dropStreams ends every stream of a client that went away.
func (s *Server) dropStreams(c *serverClient) {
	s.mu.Lock()
	streams := make([]*funnelStream, 0, len(c.streams))
	for _, st := range c.streams {
		streams = append(streams, st)
	}
	s.mu.Unlock()
	for _, st := range streams {
		st.close()
	}
}

// send queues a message for the agent, waiting a little for room.
func (c *serverClient) send(ctx context.Context, msg []byte) bool {
	select {
	case c.out <- msg:
		return true
	case <-time.After(streamSendTimeout):
		return false
	case <-ctx.Done():
		return false
	case <-c.ctx.Done():
		return false
	}
}

// chunks splits b into pieces of at most size bytes, as a range-over-func.
func chunks(b []byte, size int) func(yield func([]byte) bool) {
	return func(yield func([]byte) bool) {
		for len(b) > 0 {
			n := min(size, len(b))
			if !yield(b[:n]) {
				return
			}
			b = b[n:]
		}
	}
}

// recordConn records what is read from conn and swallows writes, so a TLS
// handshake can be aborted after the ClientHello without answering the visitor.
type recordConn struct {
	net.Conn
	r io.Reader
	// bytes read so far
	buf []byte
}

func (c *recordConn) Read(p []byte) (int, error) {
	n, err := c.r.Read(p)
	c.buf = append(c.buf, p[:n]...)
	return n, err
}

func (c *recordConn) Write(p []byte) (int, error) { return len(p), nil }

var errHelloRead = errors.New("client hello read")

// readServerName reads a TLS ClientHello from conn and returns the lower-case
// server name it asks for and every byte read, to replay to the agent.
func readServerName(conn net.Conn) (string, []byte, error) {
	_ = conn.SetReadDeadline(time.Now().Add(helloTimeout))
	defer conn.SetReadDeadline(time.Time{})
	rc := &recordConn{Conn: conn, r: io.LimitReader(conn, maxHelloBytes)}
	var name string
	err := tls.Server(rc, &tls.Config{
		GetConfigForClient: func(hello *tls.ClientHelloInfo) (*tls.Config, error) {
			name = strings.ToLower(hello.ServerName)
			return nil, errHelloRead
		},
	}).Handshake()
	if name == "" {
		if err == nil || errors.Is(err, errHelloRead) {
			err = errors.New("no server name")
		}
		return "", nil, err
	}
	return name, rc.buf, nil
}
