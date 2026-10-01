// Package ipc defines the local API the agent serves to the desktop app and CLI
// over a Unix domain socket.
package ipc

import (
	"context"
	"net"
	"net/http"
	"os"
	"path/filepath"
)

// DefaultSocketPath returns where the agent listens. MESH_SOCKET overrides it,
// which is useful when running an unprivileged dev agent.
func DefaultSocketPath() string {
	if p := os.Getenv("MESH_SOCKET"); p != "" {
		return p
	}
	return "/var/run/mesh/agent.sock"
}

// Status is returned by GET /v1/status.
type Status struct {
	Version string `json:"version"`
	State   string `json:"state"`
}

// NewClient returns an HTTP client that dials the agent socket. Request URLs
// should use the host "agent", e.g. http://agent/v1/status.
func NewClient(socketPath string) *http.Client {
	return &http.Client{
		Transport: &http.Transport{
			DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
				var d net.Dialer
				return d.DialContext(ctx, "unix", socketPath)
			},
		},
	}
}

// Listen creates the socket directory and listens on socketPath, replacing a
// stale socket left by a previous run.
func Listen(socketPath string) (net.Listener, error) {
	if err := os.MkdirAll(filepath.Dir(socketPath), 0o755); err != nil {
		return nil, err
	}
	if err := os.Remove(socketPath); err != nil && !os.IsNotExist(err) {
		return nil, err
	}
	return net.Listen("unix", socketPath)
}
