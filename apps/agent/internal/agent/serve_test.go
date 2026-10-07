package agent

import (
	"io"
	"net"
	"net/netip"
	"strconv"
	"testing"
	"time"

	"github.com/jabedzaman/meshguard/internal/ipc"
	"github.com/jabedzaman/meshguard/internal/state"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestParseServeTarget(t *testing.T) {
	for in, want := range map[string]string{
		"3000":           "127.0.0.1:3000",
		":3000":          "127.0.0.1:3000",
		"localhost:3000": "127.0.0.1:3000",
		"127.0.0.1:8080": "127.0.0.1:8080",
		"[::1]:8080":     "[::1]:8080",
		" 3000 ":         "127.0.0.1:3000",
	} {
		got, err := parseServeTarget(in)
		require.NoError(t, err, in)
		assert.Equal(t, want, got, in)
	}
	for _, bad := range []string{"", "0", "70000", "abc", "192.168.1.5:80", "example.com:80", "10.77.0.2:80"} {
		_, err := parseServeTarget(bad)
		assert.Error(t, err, bad)
	}
}

func TestValidateServe(t *testing.T) {
	rules, err := validateServe([]ipc.ServeRule{{Port: 9000, Target: "9000"}, {Port: 80, Target: "localhost:8080"}})
	require.NoError(t, err)
	assert.Equal(t, []state.ServeRule{{Port: 80, Target: "127.0.0.1:8080"}, {Port: 9000, Target: "127.0.0.1:9000"}}, rules, "canonical and sorted")

	_, err = validateServe([]ipc.ServeRule{{Port: 80, Target: "1"}, {Port: 80, Target: "2"}})
	assert.ErrorContains(t, err, "twice")
	_, err = validateServe([]ipc.ServeRule{{Port: 0, Target: "1"}})
	assert.ErrorContains(t, err, "out of range")
	_, err = validateServe([]ipc.ServeRule{{Port: 80, Target: "10.0.0.5:80"}})
	assert.ErrorContains(t, err, "on this machine")
}

// freePort returns a port nothing listens on.
func freePort(t *testing.T) int {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	defer ln.Close()
	return ln.Addr().(*net.TCPAddr).Port
}

func TestServeProxiesToALocalService(t *testing.T) {
	// A local service that answers with what it is sent, upper-cased once done.
	backend, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	defer backend.Close()
	go func() {
		for {
			conn, err := backend.Accept()
			if err != nil {
				return
			}
			go func() {
				defer conn.Close()
				data, _ := io.ReadAll(conn)
				_, _ = conn.Write([]byte("echo:" + string(data)))
			}()
		}
	}()

	// The "mesh address" is loopback here; the test needs only an address we may bind.
	m := newServeManager([]netip.Addr{netip.MustParseAddr("127.0.0.1")})
	defer m.close()
	port := freePort(t)
	m.set([]state.ServeRule{{Port: port, Target: backend.Addr().String()}})
	require.Empty(t, m.status()[0].Error)

	ask := func() string {
		conn, err := net.DialTimeout("tcp", net.JoinHostPort("127.0.0.1", itoa(port)), time.Second)
		require.NoError(t, err)
		defer conn.Close()
		_, _ = conn.Write([]byte("hello"))
		require.NoError(t, conn.(*net.TCPConn).CloseWrite())
		_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
		data, _ := io.ReadAll(conn)
		return string(data)
	}
	assert.Equal(t, "echo:hello", ask())
	assert.Equal(t, "echo:hello", ask(), "again")

	// Taking the rule away stops the listener.
	m.set(nil)
	_, err = net.DialTimeout("tcp", net.JoinHostPort("127.0.0.1", itoa(port)), time.Second)
	assert.Error(t, err)
	assert.Empty(t, m.status())
}

func TestServeReportsAPortInUse(t *testing.T) {
	taken, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	defer taken.Close()
	port := taken.Addr().(*net.TCPAddr).Port

	m := newServeManager([]netip.Addr{netip.MustParseAddr("127.0.0.1")})
	defer m.close()
	m.set([]state.ServeRule{{Port: port, Target: "127.0.0.1:1"}})
	status := m.status()
	require.Len(t, status, 1)
	assert.NotEmpty(t, status[0].Error)
}

func itoa(n int) string { return strconv.Itoa(n) }
