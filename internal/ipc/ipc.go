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
	// "not_enrolled" or "enrolled" for now; "connected" once WireGuard is up.
	State   string   `json:"state"`
	Device  *Device  `json:"device,omitempty"`
	Network *Network `json:"network,omitempty"`
	Server  string   `json:"server,omitempty"`
}

// Device is this machine's record in the mesh.
type Device struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	MeshIPv4 string `json:"meshIpv4"`
	MeshIPv6 string `json:"meshIpv6"`
}

// Network is the network this machine belongs to.
type Network struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// UpRequest is the body of POST /v1/up: enroll this machine with a token.
type UpRequest struct {
	Token  string `json:"token"`
	Server string `json:"server"`
}

// Error is returned by the local API with a non-2xx status.
type Error struct {
	Code    string `json:"code"`
	Message string `json:"message"`
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
