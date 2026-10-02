package state

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/twinlabshq/mesh/internal/identity"
)

func TestLoadBeforeSave(t *testing.T) {
	_, err := Load(filepath.Join(t.TempDir(), "mesh"))
	assert.ErrorIs(t, err, ErrNotEnrolled)
}

func TestSaveLoad(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "mesh")
	keys, err := identity.Generate()
	require.NoError(t, err)

	want := New("http://localhost:4000", keys,
		Device{ID: "d1", Name: "laptop", MeshIPv4: "10.77.1.2"},
		Network{ID: "n1", Name: "home"})
	require.NoError(t, Save(dir, want))

	file, err := os.Stat(filepath.Join(dir, fileName))
	require.NoError(t, err)
	assert.Equal(t, os.FileMode(0o600), file.Mode().Perm(), "state file holds private keys")
	folder, err := os.Stat(dir)
	require.NoError(t, err)
	assert.Equal(t, os.FileMode(0o700), folder.Mode().Perm())

	got, err := Load(dir)
	require.NoError(t, err)
	assert.Equal(t, want.Device, got.Device)
	assert.Equal(t, want.Network, got.Network)
	assert.Equal(t, want.ServerURL, got.ServerURL)

	loaded, err := got.Keys()
	require.NoError(t, err)
	assert.Equal(t, keys.IdentityPublicKey(), loaded.IdentityPublicKey())
	assert.Equal(t, keys.WireGuard, loaded.WireGuard)
}

func TestKeysRejectsCorruptState(t *testing.T) {
	_, err := (&State{IdentityPrivateKey: "not-base64", WireGuardPrivateKey: "x"}).Keys()
	assert.Error(t, err)
}
