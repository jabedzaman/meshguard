package ipc

import (
	"net/http"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestConnContextRecordsPeerCredentials(t *testing.T) {
	// Unix socket paths are limited to about 100 bytes, which macOS's temp
	// directories exceed: use a short one.
	dir, err := os.MkdirTemp("/tmp", "mg")
	require.NoError(t, err)
	t.Cleanup(func() { os.RemoveAll(dir) })
	socket := filepath.Join(dir, "agent.sock")
	ln, err := Listen(socket)
	require.NoError(t, err)

	got := make(chan Caller, 1)
	srv := &http.Server{
		ConnContext: ConnContext,
		Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			c, ok := CallerFrom(r.Context())
			assert.True(t, ok, "no caller recorded")
			got <- c
		}),
	}
	go srv.Serve(ln)
	t.Cleanup(func() { srv.Close() })

	res, err := NewClient(socket).Get("http://agent/v1/status")
	require.NoError(t, err)
	res.Body.Close()

	c := <-got
	assert.Equal(t, uint32(os.Getuid()), c.UID)
	assert.Equal(t, uint32(os.Getgid()), c.GID)
}
