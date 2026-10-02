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

	"github.com/twinlabshq/mesh/internal/state"
)

// Client calls the control plane API at ServerURL.
type Client struct {
	ServerURL string
	HTTP      *http.Client
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

// Enroll redeems an enrollment token for this device.
func (c *Client) Enroll(ctx context.Context, req EnrollRequest) (*EnrollResponse, error) {
	var res EnrollResponse
	if err := c.post(ctx, "/v1/devices/enroll", req, &res); err != nil {
		return nil, err
	}
	return &res, nil
}

func (c *Client) post(ctx context.Context, path string, body, out any) error {
	data, err := json.Marshal(body)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.ServerURL+path, bytes.NewReader(data))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

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
	return json.NewDecoder(res.Body).Decode(out)
}
