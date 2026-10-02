package coordination

import (
	"crypto/ed25519"
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
	HeaderSignature = "X-MeshGuard-Signature"
)

// SigningString is what the device signs for a request.
func SigningString(method, path, timestamp string, body []byte) string {
	sum := sha256.Sum256(body)
	return strings.ToUpper(method) + "\n" + path + "\n" + timestamp + "\n" + hex.EncodeToString(sum[:])
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
	sig := ed25519.Sign(s.Key, []byte(SigningString(req.Method, req.URL.Path, ts, body)))
	req.Header.Set(HeaderDevice, s.DeviceID)
	req.Header.Set(HeaderTimestamp, ts)
	req.Header.Set(HeaderSignature, base64.StdEncoding.EncodeToString(sig))
}
