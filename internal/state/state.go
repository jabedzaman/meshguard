// Package state persists what the agent knows about its enrollment: its keys,
// device record and network. The file holds private keys, so it is written
// with 0600 permissions in a 0700 directory.
package state

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"time"

	"github.com/jabedzaman/meshguard/internal/identity"
)

const fileName = "state.json"

// DefaultDir is where the agent keeps its state. MESHGUARD_STATE_DIR overrides it,
// which is useful for an unprivileged dev agent.
func DefaultDir() string {
	if dir := os.Getenv("MESHGUARD_STATE_DIR"); dir != "" {
		return dir
	}
	if runtime.GOOS == "darwin" {
		return "/Library/Application Support/MeshGuard"
	}
	return "/var/lib/meshguard"
}

// Device is the device record returned by enrollment.
type Device struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	MeshIPv4 string `json:"meshIpv4"`
	MeshIPv6 string `json:"meshIpv6"`
}

// Network is the network the device belongs to.
type Network struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	IPv4CIDR string `json:"ipv4Cidr"`
	IPv6CIDR string `json:"ipv6Cidr"`
	// Domain the network's devices resolve under, e.g. "brave-otter.mesh.jabed.dev";
	// empty in state saved before the control plane sent one.
	DNSDomain string `json:"dnsDomain,omitempty"`
}

// State is everything the agent persists.
type State struct {
	ServerURL           string    `json:"serverUrl"`
	IdentityPrivateKey  string    `json:"identityPrivateKey"`
	WireGuardPrivateKey string    `json:"wireguardPrivateKey"`
	Device              Device    `json:"device"`
	Network             Network   `json:"network"`
	EnrolledAt          time.Time `json:"enrolledAt"`
	// Disabled is set by `meshguard down`: stay enrolled but don't connect,
	// including after the agent restarts.
	Disabled bool `json:"disabled,omitempty"`
}

// ErrNotEnrolled is returned by Load when there is no state yet.
var ErrNotEnrolled = errors.New("device is not enrolled")

// New builds state for freshly generated keys.
func New(serverURL string, keys *identity.Keys, device Device, network Network) *State {
	return &State{
		ServerURL:           serverURL,
		IdentityPrivateKey:  base64.StdEncoding.EncodeToString(keys.Identity),
		WireGuardPrivateKey: keys.WireGuardPrivateKey(),
		Device:              device,
		Network:             network,
		EnrolledAt:          time.Now().UTC(),
	}
}

// Keys decodes the stored private keys.
func (s *State) Keys() (*identity.Keys, error) {
	id, err := base64.StdEncoding.DecodeString(s.IdentityPrivateKey)
	if err != nil || len(id) != ed25519.PrivateKeySize {
		return nil, fmt.Errorf("invalid identity key in state")
	}
	wg, err := base64.StdEncoding.DecodeString(s.WireGuardPrivateKey)
	if err != nil || len(wg) != 32 {
		return nil, fmt.Errorf("invalid wireguard key in state")
	}
	keys := &identity.Keys{Identity: ed25519.PrivateKey(id)}
	copy(keys.WireGuard[:], wg)
	return keys, nil
}

// Load reads the state from dir, or returns ErrNotEnrolled.
func Load(dir string) (*State, error) {
	data, err := os.ReadFile(filepath.Join(dir, fileName))
	if errors.Is(err, os.ErrNotExist) {
		return nil, ErrNotEnrolled
	}
	if err != nil {
		return nil, err
	}
	var s State
	if err := json.Unmarshal(data, &s); err != nil {
		return nil, fmt.Errorf("read %s: %w", fileName, err)
	}
	return &s, nil
}

// Save writes the state atomically.
func Save(dir string, s *State) error {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	data, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, fileName+".*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if err := tmp.Chmod(0o600); err != nil {
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
	return os.Rename(tmp.Name(), filepath.Join(dir, fileName))
}

// Remove deletes the saved state (`meshguard logout`).
func Remove(dir string) error {
	err := os.Remove(filepath.Join(dir, fileName))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}
