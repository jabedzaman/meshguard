package coordination

import (
	"crypto/ed25519"
	"encoding/base64"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSigningString(t *testing.T) {
	// Same vector as "matches the Go agent's signing string" in
	// packages/server-core/src/lib/device-auth.test.ts.
	assert.Equal(t,
		"POST\n/v1/devices/self/sync\n1800000000000\nAAECAwQFBgcICQoLDA0ODw\n44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a",
		SigningString("post", "/v1/devices/self/sync", "1800000000000", "AAECAwQFBgcICQoLDA0ODw", []byte("{}")))
}

func TestSignerSetsVerifiableHeaders(t *testing.T) {
	pub, priv, err := ed25519.GenerateKey(nil)
	require.NoError(t, err)
	at := time.UnixMilli(1_800_000_000_000)
	s := &Signer{DeviceID: "d1", Key: priv, Now: func() time.Time { return at }}

	body := []byte(`{"endpoints":[]}`)
	req := httptest.NewRequest("POST", "http://api.test/v1/devices/self/sync", nil)
	s.Sign(req, body)

	assert.Equal(t, "d1", req.Header.Get(HeaderDevice))
	assert.Equal(t, "1800000000000", req.Header.Get(HeaderTimestamp))
	nonce := req.Header.Get(HeaderNonce)
	assert.Len(t, nonce, 22)
	sig, err := base64.StdEncoding.DecodeString(req.Header.Get(HeaderSignature))
	require.NoError(t, err)
	msg := SigningString("POST", "/v1/devices/self/sync", "1800000000000", nonce, body)
	assert.True(t, ed25519.Verify(pub, []byte(msg), sig))

	// Every request gets its own nonce, so none can be replayed.
	again := httptest.NewRequest("POST", "http://api.test/v1/devices/self/sync", nil)
	s.Sign(again, body)
	assert.NotEqual(t, nonce, again.Header.Get(HeaderNonce))
}
