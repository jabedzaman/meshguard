// Package coordination talks to the control plane API: enrollment now;
// network map updates and heartbeats later.
package coordination

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/jabedzaman/meshguard/internal/state"
)

// Client calls the control plane API at ServerURL. Requests that act as an
// enrolled device need Signer.
type Client struct {
	ServerURL string
	HTTP      *http.Client
	Signer    *Signer
}

// NewClient returns a client with sensible timeouts.
func NewClient(serverURL string) *Client {
	return &Client{
		ServerURL: strings.TrimRight(serverURL, "/"),
		HTTP:      &http.Client{Timeout: 30 * time.Second},
	}
}

// EnrollRequest is the body of POST /v1/devices/enroll.
type EnrollRequest struct {
	Token              string `json:"token"`
	Hostname           string `json:"hostname"`
	Platform           string `json:"platform"`
	IdentityPublicKey  string `json:"identityPublicKey"`
	WireGuardPublicKey string `json:"wireguardPublicKey"`
}

// EnrollResponse is what the control plane returns for a new device.
type EnrollResponse struct {
	Device  state.Device  `json:"device"`
	Network state.Network `json:"network"`
}

// Error is an error response from the API ({"error": {"code", "message"}}).
type Error struct {
	Status    int
	Code      string `json:"code"`
	Message   string `json:"message"`
	RequestID string `json:"requestId"`
}

func (e *Error) Error() string {
	if e.Message == "" {
		return fmt.Sprintf("control plane returned %d", e.Status)
	}
	return e.Message
}

// Peer is another device in the network.
type Peer struct {
	ID                 string     `json:"id"`
	Name               string     `json:"name"`
	WireGuardPublicKey string     `json:"wireguardPublicKey"`
	MeshIPv4           string     `json:"meshIpv4"`
	MeshIPv6           string     `json:"meshIpv6"`
	Endpoints          []string   `json:"endpoints"`
	LastSeenAt         *time.Time `json:"lastSeenAt"`
}

// Relay is where to send packets for peers that can't be reached directly.
type Relay struct {
	URL string `json:"url"`
	// Token lets this device use the relay (relay.VerifyToken); empty from a
	// control plane without a relay token key.
	Token string `json:"token,omitempty"`
}

// ACL is what may reach this device from its peers.
type ACL struct {
	// "allow": everything; "deny": only what Inbound allows.
	DefaultAction string    `json:"defaultAction"`
	Inbound       []ACLRule `json:"inbound"`
}

// ACLRule lets matching traffic from peers in.
type ACLRule struct {
	// Mesh addresses of the devices it applies to; nil means any peer.
	Sources  []string `json:"sources"`
	Protocol string   `json:"protocol"` // any, tcp, udp, icmp
	// TCP/UDP destination ports, inclusive; nil for every port.
	PortFrom *int `json:"portFrom"`
	PortTo   *int `json:"portTo"`
}

// NetworkMap is everything the agent needs to configure WireGuard.
type NetworkMap struct {
	Self    state.Device  `json:"self"`
	Network state.Network `json:"network"`
	Peers   []Peer        `json:"peers"`
	Relay   *Relay        `json:"relay"`
	// Nil from a control plane without access rules: everything is allowed.
	ACL *ACL `json:"acl"`
	// STUN servers ("host:port") for discovering our public address.
	Stun []string `json:"stun"`
	// Revision identifies this map for Watch; empty from a control plane
	// that can't watch.
	Revision string `json:"revision"`
}

// SyncRequest reports where this device can be reached.
type SyncRequest struct {
	Endpoints []string `json:"endpoints"`
	// Subnets this device offers to route (`meshguard set --advertise-routes`).
	AdvertiseRoutes []string `json:"advertiseRoutes"`
}

// Sync reports this device's endpoints and returns its network map.
// Requires Signer.
func (c *Client) Sync(ctx context.Context, req SyncRequest) (*NetworkMap, error) {
	if c.Signer == nil {
		return nil, fmt.Errorf("sync requires a device signer")
	}
	var res NetworkMap
	if err := c.post(ctx, "/v1/devices/self/sync", req, &res); err != nil {
		return nil, err
	}
	return &res, nil
}

// WatchTimeout bounds one Watch call; the control plane answers within about 50s.
const WatchTimeout = 75 * time.Second

// Watch waits until the control plane has a network map other than revision
// (true: sync now) or its wait ends (false: watch again). Requires Signer.
func (c *Client) Watch(ctx context.Context, revision string) (bool, error) {
	if c.Signer == nil {
		return false, fmt.Errorf("watch requires a device signer")
	}
	ctx, cancel := context.WithTimeout(ctx, WatchTimeout)
	defer cancel()
	// The shared client's timeout is shorter than the wait.
	long := *c
	long.HTTP = &http.Client{Transport: c.HTTP.Transport}
	var res struct {
		Changed bool `json:"changed"`
	}
	if err := long.post(ctx, "/v1/devices/self/watch", map[string]string{"revision": revision}, &res); err != nil {
		return false, err
	}
	return res.Changed, nil
}

// Enroll redeems an enrollment token for this device.
func (c *Client) Enroll(ctx context.Context, req EnrollRequest) (*EnrollResponse, error) {
	var res EnrollResponse
	if err := c.post(ctx, "/v1/devices/enroll", req, &res); err != nil {
		return nil, err
	}
	return &res, nil
}

// DeleteSelf removes this device from its network (`meshguard logout`).
// Requires Signer.
func (c *Client) DeleteSelf(ctx context.Context) error {
	if c.Signer == nil {
		return fmt.Errorf("delete requires a device signer")
	}
	return c.do(ctx, http.MethodDelete, "/v1/devices/self", nil, nil)
}

func (c *Client) post(ctx context.Context, path string, body, out any) error {
	return c.do(ctx, http.MethodPost, path, body, out)
}

// do sends a JSON request (signed if Signer is set) and decodes the response
// into out. A nil body sends no body; a nil out ignores the response.
func (c *Client) do(ctx context.Context, method, path string, body, out any) error {
	var data []byte
	if body != nil {
		var err error
		if data, err = json.Marshal(body); err != nil {
			return err
		}
	}
	req, err := http.NewRequestWithContext(ctx, method, c.ServerURL+path, bytes.NewReader(data))
	if err != nil {
		return err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if c.Signer != nil {
		c.Signer.Sign(req, data)
	}

	res, err := c.HTTP.Do(req)
	if err != nil {
		return fmt.Errorf("reach control plane at %s: %w", c.ServerURL, err)
	}
	defer res.Body.Close()

	if res.StatusCode >= 300 {
		apiErr := &Error{Status: res.StatusCode}
		var envelope struct {
			Error *Error `json:"error"`
		}
		if json.NewDecoder(res.Body).Decode(&envelope) == nil && envelope.Error != nil {
			envelope.Error.Status = res.StatusCode
			apiErr = envelope.Error
		}
		return apiErr
	}
	if out == nil {
		return nil
	}
	return json.NewDecoder(res.Body).Decode(out)
}
