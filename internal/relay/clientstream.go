package relay

import (
	"context"
	"net"
	"sync"
	"time"

	"github.com/coder/websocket"
)

// streamTable holds the visitors the relay is carrying to this agent.
type streamTable struct {
	mu      sync.Mutex
	streams map[uint32]*clientStream
}

type clientStream struct {
	id uint32
	// in holds what the visitor sent until the handler reads it.
	in chan []byte
	// local is the end the handler uses; remote is ours.
	remote net.Conn
	once   sync.Once
	closed chan struct{}
}

func (t *streamTable) get(id uint32) *clientStream {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.streams[id]
}

func (t *streamTable) add(st *clientStream) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.streams == nil {
		t.streams = map[uint32]*clientStream{}
	}
	t.streams[st.id] = st
}

func (t *streamTable) remove(st *clientStream) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.streams[st.id] == st {
		delete(t.streams, st.id)
	}
}

func (t *streamTable) closeAll() {
	t.mu.Lock()
	all := make([]*clientStream, 0, len(t.streams))
	for _, st := range t.streams {
		all = append(all, st)
	}
	t.mu.Unlock()
	for _, st := range all {
		st.close()
	}
}

func (st *clientStream) close() {
	st.once.Do(func() {
		close(st.closed)
		st.remote.Close()
	})
}

// streamFrame handles a stream frame from the relay.
func (c *Client) streamFrame(ctx context.Context, conn *websocket.Conn, f StreamFrame) {
	switch f.Type {
	case FrameOpen:
		if c.OnStream == nil {
			c.sendStream(ctx, conn, StreamFrame{Type: FrameClose, ID: f.ID})
			return
		}
		// net.Pipe gives the handler a real connection, with deadlines.
		handlerEnd, ours := net.Pipe()
		st := &clientStream{id: f.ID, in: make(chan []byte, streamQueue), remote: ours, closed: make(chan struct{})}
		c.streams.add(st)
		go c.pumpToHandler(st)
		go c.pumpFromHandler(ctx, conn, st)
		go c.OnStream(handlerEnd, string(f.Data))
	case FrameData:
		st := c.streams.get(f.ID)
		if st == nil {
			return
		}
		select {
		case st.in <- append([]byte(nil), f.Data...):
		default: // the handler can't keep up
			st.close()
			c.sendStream(ctx, conn, StreamFrame{Type: FrameClose, ID: f.ID})
		}
	case FrameClose:
		if st := c.streams.get(f.ID); st != nil {
			// Queue the end after what the visitor already sent.
			select {
			case st.in <- nil:
			default:
				st.close()
				c.streams.remove(st)
			}
		}
	}
}

// pumpToHandler writes what the visitor sent into the handler's connection.
func (c *Client) pumpToHandler(st *clientStream) {
	for {
		select {
		case data := <-st.in:
			if data == nil { // the visitor is done: everything before it has been written
				st.close()
				c.streams.remove(st)
				return
			}
			if _, err := st.remote.Write(data); err != nil {
				st.close()
				return
			}
		case <-st.closed:
			return
		}
	}
}

// pumpFromHandler sends what the handler writes to the visitor, and closes
// the stream when the handler is done.
func (c *Client) pumpFromHandler(ctx context.Context, conn *websocket.Conn, st *clientStream) {
	defer c.streams.remove(st)
	buf := make([]byte, MaxStreamData)
	for {
		n, err := st.remote.Read(buf)
		if n > 0 {
			if c.sendStream(ctx, conn, StreamFrame{Type: FrameData, ID: st.id, Data: buf[:n]}) != nil {
				st.close()
				return
			}
		}
		if err != nil {
			st.close()
			c.sendStream(ctx, conn, StreamFrame{Type: FrameClose, ID: st.id})
			return
		}
	}
}

func (c *Client) sendStream(ctx context.Context, conn *websocket.Conn, f StreamFrame) error {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	return conn.Write(ctx, websocket.MessageBinary, EncodeStreamFrame(f))
}
