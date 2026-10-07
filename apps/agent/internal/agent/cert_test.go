package agent

import (
	"context"
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"encoding/pem"
	"math/big"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/jabedzaman/meshguard/internal/coordination"
	"github.com/jabedzaman/meshguard/internal/ipc"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const certName = "laptop.brave-otter.mesh.example.com"

// fakeCA signs the request it is sent for the names in `names` (default: the
// request's own), valid for `lifetime`.
func fakeCA(t *testing.T, names []string, lifetime time.Duration) *coordination.Client {
	t.Helper()
	caKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	require.NoError(t, err)
	caTmpl := &x509.Certificate{SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "Test CA"},
		NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(24 * time.Hour), IsCA: true,
		KeyUsage: x509.KeyUsageCertSign, BasicConstraintsValid: true}
	caDER, err := x509.CreateCertificate(rand.Reader, caTmpl, caTmpl, &caKey.PublicKey, caKey)
	require.NoError(t, err)
	ca, err := x509.ParseCertificate(caDER)
	require.NoError(t, err)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "/v1/devices/self/certificate", r.URL.Path)
		var body struct{ CSR string }
		require.NoError(t, json.NewDecoder(r.Body).Decode(&struct {
			CSR *string `json:"csr"`
		}{&body.CSR}))
		block, _ := pem.Decode([]byte(body.CSR))
		require.NotNil(t, block)
		req, err := x509.ParseCertificateRequest(block.Bytes)
		require.NoError(t, err)
		require.NoError(t, req.CheckSignature())
		dnsNames := names
		if dnsNames == nil {
			dnsNames = req.DNSNames
		}
		der, err := x509.CreateCertificate(rand.Reader, &x509.Certificate{
			SerialNumber: big.NewInt(2), DNSNames: dnsNames,
			NotBefore: time.Now().Add(-time.Minute), NotAfter: time.Now().Add(lifetime),
			KeyUsage: x509.KeyUsageDigitalSignature,
		}, ca, req.PublicKey, caKey)
		require.NoError(t, err)
		chain := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
		_ = json.NewEncoder(w).Encode(map[string]string{"name": certName, "certificate": string(chain)})
	}))
	t.Cleanup(srv.Close)

	_, priv, err := ed25519.GenerateKey(rand.Reader)
	require.NoError(t, err)
	cl := coordination.NewClient(srv.URL)
	cl.Signer = &coordination.Signer{DeviceID: "d1", Key: priv}
	return cl
}

func TestRequestCertReturnsAMatchingPair(t *testing.T) {
	cert, err := requestCert(context.Background(), fakeCA(t, nil, 90*24*time.Hour), certName)
	require.NoError(t, err)
	assert.Equal(t, certName, cert.Name)
	assert.WithinDuration(t, time.Now().Add(90*24*time.Hour), cert.NotAfter, time.Minute)
	_, err = checkCert(cert, certName)
	assert.NoError(t, err)
}

func TestRequestCertRefusesACertificateForAnotherName(t *testing.T) {
	_, err := requestCert(context.Background(), fakeCA(t, []string{"server." + certName}, time.Hour*24*90), certName)
	assert.ErrorContains(t, err, "unusable certificate")
}

func TestSavedCertIsKeptUntilItNearsExpiry(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "certs")
	_, ok := loadSavedCert(dir, certName, time.Now())
	assert.False(t, ok, "nothing saved yet")

	cert, err := requestCert(context.Background(), fakeCA(t, nil, 90*24*time.Hour), certName)
	require.NoError(t, err)
	require.NoError(t, saveCert(dir, cert))

	keyInfo, err := os.Stat(filepath.Join(dir, certName+".key"))
	require.NoError(t, err)
	assert.Equal(t, os.FileMode(0o600), keyInfo.Mode().Perm(), "the key is private")

	saved, ok := loadSavedCert(dir, certName, time.Now())
	require.True(t, ok)
	assert.Equal(t, cert.Certificate, saved.Certificate)
	assert.Equal(t, cert.Key, saved.Key)
	assert.True(t, saved.NotAfter.Equal(cert.NotAfter))

	_, ok = loadSavedCert(dir, certName, time.Now().Add(61*24*time.Hour))
	assert.False(t, ok, "less than a third of its life left: get a new one")
	_, ok = loadSavedCert(dir, certName, time.Now().Add(55*24*time.Hour))
	assert.True(t, ok, "more than a third left")
	_, ok = loadSavedCert(dir, "other."+certName, time.Now())
	assert.False(t, ok, "a different name (the device was renamed)")
}

func TestCertEndpointNeedsEnrollment(t *testing.T) {
	h := (&Agent{Version: "test", StateDir: t.TempDir()}).Handler()
	rec, _, apiErr := call(t, h, http.MethodPost, "/v1/cert", ipc.CertRequest{})
	assert.Equal(t, http.StatusConflict, rec.Code)
	assert.Equal(t, "not_enrolled", apiErr.Code)
}
