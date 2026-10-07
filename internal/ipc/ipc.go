// Package ipc defines the local API the agent serves to the desktop app and CLI
// over a Unix domain socket.
package ipc

import (
	"context"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

// DefaultSocketPath returns where the agent listens. MESHGUARD_SOCKET overrides it,
// which is useful when running an unprivileged dev agent.
func DefaultSocketPath() string {
	if p := os.Getenv("MESHGUARD_SOCKET"); p != "" {
		return p
	}
	return "/var/run/meshguard/agent.sock"
}

// Status is returned by GET /v1/status.
type Status struct {
	Version string `json:"version"`
	// "not_enrolled", "down" (enrolled, disconnected by `meshguard down`),
	// "enrolled" (registered but not connected; see Problem) or "connected"
	// (WireGuard up and synced).
	State   string   `json:"state"`
	Problem string   `json:"problem,omitempty"`
	Device  *Device  `json:"device,omitempty"`
	Network *Network `json:"network,omitempty"`
	Server  string   `json:"server,omitempty"`
	// WireGuard interface name, once up.
	Interface string       `json:"interface,omitempty"`
	Relay     *RelayStatus `json:"relay,omitempty"`
	// Public address as seen by STUN, if known.
	PublicEndpoint string     `json:"publicEndpoint,omitempty"`
	LastSyncAt     *time.Time `json:"lastSyncAt,omitempty"`
	// Watching: the control plane pushes changes, so syncs are rarer and
	// LastSyncAt (or the last confirmation that nothing changed) can be up to
	// a minute old.
	Watching bool       `json:"watching,omitempty"`
	DNS      *DNSStatus `json:"dns,omitempty"`
	// Access rules for traffic from peers, once synced.
	ACL *ACLStatus `json:"acl,omitempty"`
	// Settings from `meshguard set`.
	Prefs *Prefs `json:"prefs,omitempty"`
	// Subnets this device routes for its peers (approved).
	Serving []string `json:"serving,omitempty"`
	// Subnets of peers this device sends traffic to (needs accept-routes).
	Accepted []string `json:"accepted,omitempty"`
	// Local services shared with the mesh, and any that can't listen.
	Serve []ServeRule `json:"serve,omitempty"`
	// Sharing a local port with the internet through the relay.
	Funnel *FunnelStatus `json:"funnel,omitempty"`
	// App connectors: domains whose traffic goes through a device.
	Connectors []ConnectorStatus `json:"connectors,omitempty"`
	// Services in the network and who serves them.
	Services []Service `json:"services,omitempty"`
	// The peer all traffic goes through, once it is in use (see Prefs.ExitNode).
	ExitNode string `json:"exitNode,omitempty"`
	// Serving is also set when this device is an approved exit node.
	ServingExitNode bool   `json:"servingExitNode,omitempty"`
	Peers           []Peer `json:"peers,omitempty"`
}

// FunnelStatus describes public access through the relay.
type FunnelStatus struct {
	// The public name, e.g. "laptop.brave-otter.mesh.jabed.dev".
	Name string `json:"name"`
	// An owner or admin has turned it on for this device.
	Allowed bool `json:"allowed"`
	// The local port shared; 0 when none is chosen.
	Port int `json:"port"`
	// "off", "waiting for approval", "waiting for a certificate", "live".
	State   string `json:"state"`
	Problem string `json:"problem,omitempty"`
}

// CertRequest is the body of POST /v1/cert.
type CertRequest struct {
	// Issue a new certificate even if the saved one is still good.
	Force bool `json:"force,omitempty"`
}

// Cert is a TLS certificate for the device's mesh name.
type Cert struct {
	// e.g. "laptop.brave-otter.mesh.jabed.dev".
	Name string `json:"name"`
	// PEM chain and private key.
	Certificate string    `json:"certificate"`
	Key         string    `json:"key"`
	NotAfter    time.Time `json:"notAfter"`
	// Issued now rather than the saved one.
	Renewed bool `json:"renewed"`
}

// ConnectorStatus is an app connector as this device sees it.
type ConnectorStatus struct {
	Name    string   `json:"name"`
	Domains []string `json:"domains"`
	// The peer the domains go through; empty when this device hosts it or no host is online.
	Host    string `json:"host,omitempty"`
	Hosting bool   `json:"hosting,omitempty"`
	// Addresses learned for the domains and routed through the host now.
	Routes int `json:"routes,omitempty"`
}

// Service is a named virtual address in the network.
type Service struct {
	Name string `json:"name"`
	// e.g. "web.svc.brave-otter.mesh.jabed.dev".
	DNSName string `json:"dnsName"`
	VIP     string `json:"vip"`
	// The peer traffic goes to; empty when this device hosts it or no host is online.
	Host string `json:"host,omitempty"`
	// This device serves it.
	Hosting bool `json:"hosting,omitempty"`
}

// Prefs are the device's settings (GET /v1/prefs).
type Prefs struct {
	AdvertiseRoutes []string `json:"advertiseRoutes"`
	AcceptRoutes    bool     `json:"acceptRoutes"`
	// Offers to be an exit node.
	AdvertiseExitNode bool `json:"advertiseExitNode"`
	// The peer used as exit node, if any.
	ExitNode string `json:"exitNode"`
	// Local services shared with the mesh (meshguard serve).
	Serve []ServeRule `json:"serve"`
	// The local port shared with the internet (meshguard funnel); 0 for none.
	FunnelPort int `json:"funnelPort"`
}

// ServeRule shares a local TCP service: the device's mesh address on Port
// reaches Target (a loopback "host:port").
type ServeRule struct {
	Port   int    `json:"port"`
	Target string `json:"target"`
	// Why it isn't listening, in status.
	Error string `json:"error,omitempty"`
}

// PrefsUpdate is the body of PATCH /v1/prefs; fields left nil are unchanged.
// An empty AdvertiseRoutes list clears the routes.
type PrefsUpdate struct {
	AdvertiseRoutes   *[]string `json:"advertiseRoutes,omitempty"`
	AcceptRoutes      *bool     `json:"acceptRoutes,omitempty"`
	AdvertiseExitNode *bool     `json:"advertiseExitNode,omitempty"`
	// "" stops using an exit node.
	ExitNode *string `json:"exitNode,omitempty"`
	// Replaces the shared services.
	Serve *[]ServeRule `json:"serve,omitempty"`
	// The local port to share with the internet; 0 stops.
	FunnelPort *int `json:"funnelPort,omitempty"`
}

// ACLStatus summarizes the access rules this device enforces.
type ACLStatus struct {
	// "allow": every peer may reach this device; "deny": only Rules allow.
	DefaultAction string `json:"defaultAction"`
	Rules         int    `json:"rules"`
	// Packets from peers refused since WireGuard started.
	Dropped uint64 `json:"dropped"`
}

// DNSStatus describes private DNS: devices resolve as <name>.<domain>.
type DNSStatus struct {
	// This device's name, e.g. "laptop.brave-otter.mesh.jabed.dev".
	Name string `json:"name"`
	// The network's domain, e.g. "brave-otter.mesh.jabed.dev"; empty until the
	// control plane sends one.
	Domain string `json:"domain,omitempty"`
	// Where the agent answers inside its TUN, e.g. "10.77.0.53" (the
	// network's address + 53); empty if it doesn't.
	Resolver string `json:"resolver,omitempty"`
	// How the OS sends the domain's queries to it, e.g. "systemd-resolved";
	// empty if it doesn't (see Problem).
	Configured string `json:"configured,omitempty"`
	Problem    string `json:"problem,omitempty"`
}

// RelayStatus describes the agent's relay connection.
type RelayStatus struct {
	URL       string `json:"url"`
	Connected bool   `json:"connected"`
}

// Peer is another device in the network, as this agent sees it.
type Peer struct {
	Name string `json:"name"`
	// e.g. "laptop.brave-otter.mesh.jabed.dev".
	DNSName  string `json:"dnsName"`
	MeshIPv4 string `json:"meshIpv4"`
	MeshIPv6 string `json:"meshIpv6"`
	// "ip:port" when direct; empty (ViaRelay) when through the relay.
	Endpoint string `json:"endpoint,omitempty"`
	ViaRelay bool   `json:"viaRelay,omitempty"`
	// Approved subnets this peer routes.
	Routes        []string   `json:"routes,omitempty"`
	LastHandshake *time.Time `json:"lastHandshake,omitempty"`
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

// UpRequest is the body of POST /v1/up: enroll this machine with a token, or
// (no token) reconnect after `meshguard down`.
type UpRequest struct {
	Token  string `json:"token,omitempty"`
	Server string `json:"server,omitempty"`
}

// LogoutRequest is the body of POST /v1/logout.
type LogoutRequest struct {
	// Forget this device locally even if the control plane can't be told.
	Force bool `json:"force,omitempty"`
}

// Netcheck is returned by GET /v1/netcheck: what the network looks like from
// this device.
type Netcheck struct {
	// Addresses advertised to peers (local, then public).
	Endpoints []string `json:"endpoints"`
	// Public address per STUN server; differing ports mean a symmetric NAT.
	Stun []StunResult `json:"stun"`
	// "endpoint-independent", "symmetric" or "unknown".
	NAT   string       `json:"nat"`
	Relay *RelayStatus `json:"relay,omitempty"`
}

// StunResult is one STUN server's answer.
type StunResult struct {
	Server    string `json:"server"`
	Public    string `json:"public,omitempty"`
	LatencyMs int64  `json:"latencyMs,omitempty"`
	Error     string `json:"error,omitempty"`
}

// Access is returned by GET /v1/access?protocol=tcp&port=22: which peers may
// open connections to this device by its access rules.
type Access struct {
	// False before the first sync, when new inbound traffic is dropped.
	Synced bool `json:"synced"`
	// "allow" or "deny", as in ACLStatus.
	DefaultAction string       `json:"defaultAction,omitempty"`
	Peers         []PeerAccess `json:"peers"`
}

// PeerAccess says whether one peer may connect.
type PeerAccess struct {
	Name     string `json:"name"`
	MeshIPv4 string `json:"meshIpv4"`
	Allowed  bool   `json:"allowed"`
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
