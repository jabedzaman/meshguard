package agent

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"time"

	"github.com/jabedzaman/meshguard/internal/coordination"
	"github.com/jabedzaman/meshguard/internal/dns"
	"github.com/jabedzaman/meshguard/internal/ipc"
	"github.com/jabedzaman/meshguard/internal/state"
)

// certRenewFraction is how much of a certificate's lifetime must be left to
// keep using it: a third, as certbot renews 90-day certificates with 30 days
// to go. It also suits CAs that issue certificates for a few days.
const certRenewFraction = 3

// handleCert returns a TLS certificate for the device's mesh name: the saved
// one while it is good, else a new one the control plane has the CA sign for
// a request made here (the private key never leaves the device). Both are
// kept in the state directory.
func (a *Agent) handleCert(w http.ResponseWriter, r *http.Request) {
	var req ipc.CertRequest
	_ = json.NewDecoder(r.Body).Decode(&req) // empty body is fine

	a.certMu.Lock() // a CA order can take a minute; one at a time, and not under a.mu
	defer a.certMu.Unlock()

	a.mu.Lock()
	st, err := state.Load(a.StateDir)
	a.mu.Unlock()
	if err != nil {
		writeError(w, http.StatusConflict, "not_enrolled", "this machine isn't in a network")
		return
	}
	if st.Network.DNSDomain == "" {
		writeError(w, http.StatusConflict, "no_domain", "the network's domain hasn't arrived from the control plane yet: try again in a few seconds")
		return
	}
	name := dns.Name(st.Device.Name, st.Network.DNSDomain)
	dir := filepath.Join(a.StateDir, "certs")

	if !req.Force {
		if cert, ok := loadSavedCert(dir, name, time.Now()); ok {
			writeJSON(w, http.StatusOK, cert)
			return
		}
	}

	cl, _, err := client(st)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "keys_unreadable", err.Error())
		return
	}
	cert, err := requestCert(r.Context(), cl, name)
	var apiErr *coordination.Error
	switch {
	case errors.As(err, &apiErr):
		writeError(w, http.StatusBadGateway, apiErr.Code, apiErr.Message)
		return
	case err != nil:
		writeError(w, http.StatusBadGateway, "certificate_failed", err.Error())
		return
	}
	if err := saveCert(dir, cert); err != nil {
		writeError(w, http.StatusInternalServerError, "state_unwritable", err.Error())
		return
	}
	cert.Renewed = true
	writeJSON(w, http.StatusOK, cert)
}

// requestCert makes a key and a request for name, has the control plane get it
// signed and checks the answer is for that name and key.
func requestCert(ctx context.Context, cl *coordination.Client, name string) (ipc.Cert, error) {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return ipc.Cert{}, err
	}
	der, err := x509.CreateCertificateRequest(rand.Reader, &x509.CertificateRequest{
		Subject:  pkix.Name{CommonName: name},
		DNSNames: []string{name},
	}, key)
	if err != nil {
		return ipc.Cert{}, err
	}
	csr := string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE REQUEST", Bytes: der}))

	res, err := cl.Certificate(ctx, csr)
	if err != nil {
		return ipc.Cert{}, err
	}
	keyDER, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		return ipc.Cert{}, err
	}
	cert := ipc.Cert{
		Name:        name,
		Certificate: res.Certificate,
		Key:         string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: keyDER})),
	}
	leaf, err := checkCert(cert, name)
	if err != nil {
		return ipc.Cert{}, fmt.Errorf("the control plane returned an unusable certificate: %w", err)
	}
	cert.NotAfter = leaf.NotAfter
	return cert, nil
}

// checkCert verifies the PEM pair loads together and the leaf is for name.
func checkCert(c ipc.Cert, name string) (*x509.Certificate, error) {
	pair, err := tls.X509KeyPair([]byte(c.Certificate), []byte(c.Key))
	if err != nil {
		return nil, err
	}
	leaf, err := x509.ParseCertificate(pair.Certificate[0])
	if err != nil {
		return nil, err
	}
	if !slices.Equal(leaf.DNSNames, []string{name}) {
		return nil, fmt.Errorf("it is for %v, not %s", leaf.DNSNames, name)
	}
	return leaf, nil
}

func certFiles(dir, name string) (certFile, keyFile string) {
	return filepath.Join(dir, name+".crt"), filepath.Join(dir, name+".key")
}

// loadSavedCert returns the saved certificate for name if it is valid for at
// least a third of its lifetime more.
func loadSavedCert(dir, name string, now time.Time) (ipc.Cert, bool) {
	certFile, keyFile := certFiles(dir, name)
	certPEM, err1 := os.ReadFile(certFile)
	keyPEM, err2 := os.ReadFile(keyFile)
	if err1 != nil || err2 != nil {
		return ipc.Cert{}, false
	}
	c := ipc.Cert{Name: name, Certificate: string(certPEM), Key: string(keyPEM)}
	leaf, err := checkCert(c, name)
	renewAt := leaf.NotAfter.Add(-leaf.NotAfter.Sub(leaf.NotBefore) / certRenewFraction)
	if err != nil || !now.Before(renewAt) || now.Before(leaf.NotBefore) {
		return ipc.Cert{}, false
	}
	c.NotAfter = leaf.NotAfter
	return c, true
}

// saveCert writes the pair, the key readable by its owner only.
func saveCert(dir string, c ipc.Cert) error {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	certFile, keyFile := certFiles(dir, c.Name)
	if err := writeFileAtomic(keyFile, []byte(c.Key), 0o600); err != nil {
		return err
	}
	return writeFileAtomic(certFile, []byte(c.Certificate), 0o644)
}

func writeFileAtomic(path string, data []byte, mode os.FileMode) error {
	tmp, err := os.CreateTemp(filepath.Dir(path), filepath.Base(path)+".*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if err := tmp.Chmod(mode); err != nil {
		tmp.Close()
		return err
	}
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), path)
}
