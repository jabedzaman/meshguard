// Package netmark keeps the agent's own connections (control plane, relay)
// off the mesh interface when an exit node sends everything else through it.
// On Linux its sockets carry Mark, which the exit node's routing rules skip;
// WireGuard's socket is marked the same way.
package netmark

import (
	"context"
	"net"
	"net/http"
	"time"
)

// Mark is the firewall mark of the agent's own packets (51820, as in wg-quick).
const Mark = 51820

// DialContext dials with the mark set (a plain dial where marks don't exist).
func DialContext(ctx context.Context, network, addr string) (net.Conn, error) {
	d := net.Dialer{Timeout: 30 * time.Second, KeepAlive: 30 * time.Second, Control: control}
	return d.DialContext(ctx, network, addr)
}

// Transport is the default HTTP transport with marked sockets.
func Transport() *http.Transport {
	t := http.DefaultTransport.(*http.Transport).Clone()
	t.DialContext = DialContext
	return t
}
