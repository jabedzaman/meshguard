package coordination

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// Device request signing headers. Keep in sync with
// packages/server-core/src/lib/device-auth.ts.
const (
	HeaderDevice    = "X-MeshGuard-Device"
	HeaderTimestamp = "X-MeshGuard-Timestamp"
	HeaderNonce     = "X-MeshGuard-Nonce"
	HeaderSignature = "X-MeshGuard-Signature"
)

// SigningString is what the device signs for a request. The nonce makes
// every request unique, so the control plane can refuse a replayed one.
func SigningString(method, path, timestamp, nonce string, body []byte) string {
	sum := sha256.Sum256(body)
	return strings.ToUpper(method) + "\n" + path + "\n" + timestamp + "\n" + nonce + "\n" + hex.EncodeToString(sum[:])
}

// Signer signs control plane requests as a device.
type Signer struct {
	DeviceID string
	Key      ed25519.PrivateKey
	Now      func() time.Time
}

// Sign sets the device signature headers on req for the given body.
func (s *Signer) Sign(req *http.Request, body []byte) {
	now := time.Now
	if s.Now != nil {
		now = s.Now
	}
	ts := strconv.FormatInt(now().UnixMilli(), 10)
	nonce := newNonce()
	sig := ed25519.Sign(s.Key, []byte(SigningString(req.Method, req.URL.Path, ts, nonce, body)))
	req.Header.Set(HeaderDevice, s.DeviceID)
	req.Header.Set(HeaderTimestamp, ts)
	req.Header.Set(HeaderNonce, nonce)
	req.Header.Set(HeaderSignature, base64.StdEncoding.EncodeToString(sig))
}

// newNonce returns 16 random bytes, base64url without padding.
func newNonce() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b) // never fails (crypto/rand panics instead)
	return base64.RawURLEncoding.EncodeToString(b)
}
