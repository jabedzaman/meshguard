package ipc

import (
	"context"
	"net"
)

// Caller is the local process on the other end of an agent socket connection,
// as reported by the kernel (not by the client).
type Caller struct {
	UID uint32
	GID uint32
}

type callerKey struct{}

// ConnContext is an http.Server ConnContext hook that records the peer
// credentials of each Unix socket connection. Connections whose credentials
// can't be read get no Caller and are refused by the agent.
func ConnContext(ctx context.Context, c net.Conn) context.Context {
	uc, ok := c.(*net.UnixConn)
	if !ok {
		return ctx
	}
	caller, err := peerCredentials(uc)
	if err != nil {
		return ctx
	}
	return WithCaller(ctx, caller)
}

// WithCaller returns ctx carrying caller.
func WithCaller(ctx context.Context, caller Caller) context.Context {
	return context.WithValue(ctx, callerKey{}, caller)
}

// CallerFrom returns the caller recorded by ConnContext.
func CallerFrom(ctx context.Context) (Caller, bool) {
	c, ok := ctx.Value(callerKey{}).(Caller)
	return c, ok
}
