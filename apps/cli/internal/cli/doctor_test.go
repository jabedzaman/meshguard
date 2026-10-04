package cli

import (
	"errors"
	"net/netip"
	"os"
	"syscall"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/jabedzaman/meshguard/internal/ipc"
)

var now = time.Date(2026, 10, 4, 12, 0, 0, 0, time.UTC)

func ago(d time.Duration) *time.Time { t := now.Add(-d); return &t }

// healthy is a connected device with one direct and one relayed peer, where
// every probe succeeds.
func healthy() (*ipc.Status, probes) {
	s := &ipc.Status{
		Version: "dev", State: "connected", Server: "https://api.example.com",
		Device:     &ipc.Device{Name: "thinkpad", MeshIPv4: "10.77.0.2"},
		Network:    &ipc.Network{Name: "home"},
		Interface:  "meshguard0",
		LastSyncAt: ago(4 * time.Second),
		Relay:      &ipc.RelayStatus{URL: "wss://relay.example.com/relay", Connected: true},
		DNS:        &ipc.DNSStatus{Name: "thinkpad.internal", Resolver: "10.77.0.2:53", Configured: "systemd-resolved"},
		ACL:        &ipc.ACLStatus{DefaultAction: "allow"},
		Peers: []ipc.Peer{
			{Name: "macbook", DNSName: "macbook.internal", MeshIPv4: "10.77.0.3", Endpoint: "192.168.1.5:51820", LastHandshake: ago(12 * time.Second)},
			{Name: "server", DNSName: "server.internal", MeshIPv4: "10.77.0.4", ViaRelay: true, LastHandshake: ago(time.Minute)},
		},
	}
	records := map[string]string{"thinkpad.internal": "10.77.0.2", "macbook.internal": "10.77.0.3", "server.internal": "10.77.0.4"}
	return s, probes{
		status: func() (ipc.Status, error) { return *s, nil },
		netcheck: func() (ipc.Netcheck, error) {
			return ipc.Netcheck{NAT: "endpoint-independent", Stun: []ipc.StunResult{
				{Server: "a", Public: "203.0.113.7:51820"}, {Server: "b", Public: "203.0.113.7:51820"},
			}}, nil
		},
		access: func(string, int) (ipc.Access, error) {
			return ipc.Access{Synced: true, DefaultAction: "allow", Peers: []ipc.PeerAccess{
				{Name: "macbook", Allowed: true}, {Name: "server", Allowed: true},
			}}, nil
		},
		resolve: func(name string) ([]string, error) {
			if ip, ok := records[name]; ok {
				return []string{ip}, nil
			}
			return nil, errors.New("no such host")
		},
		nameservers: func() []string { return []string{"127.0.0.53"} },
		route:       func(string) (string, error) { return "meshguard0", nil },
		listeners:   func(int) ([]netip.Addr, error) { return []netip.Addr{netip.IPv4Unspecified()}, nil },
		dial:        func(string) error { return nil },
		ping:        func(string) error { return nil },
		now:         func() time.Time { return now },
	}
}

// find returns the check named name, failing the test if there isn't one.
func find(t *testing.T, checks []check, name string) check {
	t.Helper()
	for _, c := range checks {
		if c.Name == name {
			return c
		}
	}
	require.Failf(t, "no check", "%q in %+v", name, checks)
	return check{}
}

func TestDoctorHealthy(t *testing.T) {
	_, p := healthy()
	checks := runDoctor(p, "", 0)
	for _, c := range checks {
		assert.Equal(t, checkOK, c.Status, "%+v", c)
	}
	assert.Equal(t, "thinkpad.internal → 10.77.0.2", find(t, checks, "dns").Detail)
	assert.Equal(t, "direct 192.168.1.5:51820, handshake 12s ago", find(t, checks, "macbook").Detail)
	assert.Equal(t, "relay, handshake 1m0s ago", find(t, checks, "server").Detail)
	assert.Equal(t, "peers", find(t, checks, "server").Section)
}

func TestDoctorStopsWhenNothingElseCanWork(t *testing.T) {
	_, p := healthy()
	p.status = func() (ipc.Status, error) { return ipc.Status{}, errors.New("agent not reachable") }
	checks := runDoctor(p, "", 0)
	require.Len(t, checks, 1)
	assert.Equal(t, checkFail, checks[0].Status)

	s, p := healthy()
	s.State, s.Interface = "not_enrolled", ""
	checks = runDoctor(p, "", 0)
	require.Len(t, checks, 2)
	assert.Equal(t, checkFail, find(t, checks, "network").Status)

	s, p = healthy()
	s.Interface, s.Problem = "", "WireGuard is not running: operation not permitted"
	checks = runDoctor(p, "macbook", 0)
	c := find(t, checks, "wireguard")
	assert.Equal(t, checkFail, c.Status)
	assert.Equal(t, s.Problem, c.Detail)
	assert.Equal(t, "wireguard", checks[len(checks)-1].Name, "no peer checks without WireGuard")
}

func TestDoctorDeviceProblems(t *testing.T) {
	s, p := healthy()
	s.LastSyncAt = ago(2 * time.Minute)
	s.Problem = "cannot reach the control plane: connection refused"
	s.Relay.Connected = false
	s.ACL = &ipc.ACLStatus{DefaultAction: "deny"}
	s.Peers[1].LastHandshake = nil
	p.route = func(string) (string, error) { return "tun0", nil }
	p.netcheck = func() (ipc.Netcheck, error) {
		return ipc.Netcheck{NAT: "symmetric", Stun: []ipc.StunResult{{Public: "203.0.113.7:1"}, {Public: "203.0.113.7:2"}}}, nil
	}
	p.resolve = func(string) ([]string, error) { return nil, errors.New("no such host") }
	checks := runDoctor(p, "", 0)

	c := find(t, checks, "control plane")
	assert.Equal(t, checkFail, c.Status)
	assert.Equal(t, s.Problem, c.Detail)
	c = find(t, checks, "route")
	assert.Equal(t, checkFail, c.Status)
	assert.Contains(t, c.Detail, "goes through tun0, not meshguard0")
	assert.Equal(t, checkWarn, find(t, checks, "relay").Status)
	assert.Equal(t, checkWarn, find(t, checks, "nat").Status)
	c = find(t, checks, "dns")
	assert.Equal(t, checkWarn, c.Status)
	assert.Contains(t, c.Fix, "resolvectl status meshguard0")

	// resolved has the names, but resolv.conf points programs elsewhere (WSL).
	p.nameservers = func() []string { return []string{"100.100.100.100"} }
	c = find(t, runDoctor(p, "", 0), "dns")
	assert.Contains(t, c.Fix, "ln -sf /run/systemd/resolve/stub-resolv.conf /etc/resolv.conf")
	assert.Contains(t, find(t, checks, "access").Detail, "no peer can open connections")
	assert.Equal(t, checkOK, find(t, checks, "macbook").Status)
	assert.Equal(t, "no handshake yet", find(t, checks, "server").Detail)
}

func TestDoctorPeer(t *testing.T) {
	_, p := healthy()
	checks := runDoctor(p, "mac", 22)
	for _, name := range []string{"wireguard", "route", "dns", "ping", "port"} {
		c := find(t, checks, name)
		if c.Section == "macbook" {
			assert.Equal(t, checkOK, c.Status, "%+v", c)
		}
	}
	assert.Equal(t, "10.77.0.3:22 accepts connections", checks[len(checks)-1].Detail)

	// Connected but pings and the port get nothing back: likely its rules.
	p.ping = func(string) error { return errors.New("exit status 1") }
	p.dial = func(string) error { return os.ErrDeadlineExceeded }
	checks = runDoctor(p, "macbook", 22)
	c := checks[len(checks)-2]
	assert.Equal(t, "ping", c.Name)
	assert.Equal(t, checkWarn, c.Status)
	assert.Contains(t, c.Fix, "access rules may not allow ICMP")
	c = checks[len(checks)-1]
	assert.Equal(t, checkFail, c.Status)
	assert.Contains(t, c.Fix, "on macbook, meshguard doctor --port 22")

	p.dial = func(string) error { return syscall.ECONNREFUSED }
	c = runDoctor(p, "macbook", 22)[len(checks)-1]
	assert.Contains(t, c.Detail, "nothing listens on port 22")

	checks = runDoctor(p, "nope", 0)
	c = checks[len(checks)-1]
	assert.Equal(t, checkFail, c.Status)
	assert.Contains(t, c.Detail, `no peer named "nope"`)
}

func TestDoctorLocalPort(t *testing.T) {
	_, p := healthy()
	checks := runDoctor(p, "", 8080)
	assert.Equal(t, "on 0.0.0.0:8080", find(t, checks, "listening").Detail)
	c := checks[len(checks)-1]
	assert.Equal(t, "port 8080", c.Section)
	assert.Equal(t, "every peer may connect", c.Detail)

	p.listeners = func(int) ([]netip.Addr, error) { return []netip.Addr{netip.MustParseAddr("127.0.0.1")}, nil }
	p.access = func(string, int) (ipc.Access, error) {
		return ipc.Access{Synced: true, DefaultAction: "deny", Peers: []ipc.PeerAccess{
			{Name: "macbook", Allowed: true}, {Name: "server"},
		}}, nil
	}
	checks = runDoctor(p, "", 8080)
	c = find(t, checks, "listening")
	assert.Equal(t, checkFail, c.Status)
	assert.Equal(t, "only on 127.0.0.1:8080, which peers can't reach", c.Detail)
	assert.Contains(t, c.Fix, "-p 8080:8080, not -p 127.0.0.1:8080:8080")
	assert.Equal(t, "allowed: macbook; blocked: server", checks[len(checks)-1].Detail)

	p.listeners = func(int) ([]netip.Addr, error) { return []netip.Addr{netip.MustParseAddr("10.77.0.2")}, nil }
	assert.Equal(t, checkOK, find(t, runDoctor(p, "", 8080), "listening").Status, "the mesh address is reachable")
	p.listeners = func(int) ([]netip.Addr, error) { return nil, nil }
	assert.Equal(t, "nothing listens on tcp/8080", find(t, runDoctor(p, "", 8080), "listening").Detail)
}

func TestParseRoutes(t *testing.T) {
	dev, err := parseIPRouteGet([]byte("10.77.0.3 dev meshguard0 src 10.77.0.2 uid 1000 \n    cache \n"))
	require.NoError(t, err)
	assert.Equal(t, "meshguard0", dev)

	dev, err = parseRouteGet([]byte(`   route to: 10.77.0.3
destination: 10.77.0.0
       mask: 255.255.0.0
  interface: utun4
      flags: <UP,DONE,CLONING,STATIC>
`))
	require.NoError(t, err)
	assert.Equal(t, "utun4", dev)

	_, err = parseIPRouteGet([]byte("RTNETLINK answers: Network is unreachable"))
	assert.Error(t, err)
}

func TestParseProcNetTCP(t *testing.T) {
	tcp := []byte(`  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 0100007F:1F90 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 1 1 0 100 0 0 10 0
   1: 00000000:0016 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 2 1 0 100 0 0 10 0
   2: 02004D0A:1F90 03004D0A:D431 01 00000000:00000000 00:00000000 00000000  1000        0 3 1 0 20 4 30 10 -1
`)
	assert.Equal(t, []netip.Addr{netip.MustParseAddr("127.0.0.1")}, parseProcNetTCP(tcp, 8080), "only LISTEN sockets")
	assert.Equal(t, []netip.Addr{netip.IPv4Unspecified()}, parseProcNetTCP(tcp, 22))

	tcp6 := []byte(`  sl  local_address                         remote_address                        st
   0: 00000000000000000000000000000000:1F90 00000000000000000000000000000000:0000 0A
   1: 00000000000000000000000001000000:0016 00000000000000000000000000000000:0000 0A
`)
	assert.Equal(t, []netip.Addr{netip.IPv6Unspecified()}, parseProcNetTCP(tcp6, 8080))
	assert.Equal(t, []netip.Addr{netip.IPv6Loopback()}, parseProcNetTCP(tcp6, 22))
}

func TestParseNetstat(t *testing.T) {
	out := []byte(`Active Internet connections (including servers)
Proto Recv-Q Send-Q  Local Address          Foreign Address        (state)
tcp4       0      0  127.0.0.1.8080         *.*                    LISTEN
tcp6       0      0  ::1.8080               *.*                    LISTEN
tcp46      0      0  *.22                   *.*                    LISTEN
tcp4       0      0  10.77.0.2.8080         10.77.0.3.53321        ESTABLISHED
tcp4       0      0  127.0.0.1.18080        *.*                    LISTEN
`)
	assert.Equal(t, []netip.Addr{netip.MustParseAddr("127.0.0.1"), netip.IPv6Loopback()}, parseNetstat(out, 8080))
	assert.Equal(t, []netip.Addr{netip.IPv4Unspecified()}, parseNetstat(out, 22))
}

func TestParseResolvConf(t *testing.T) {
	data := []byte("# generated\nnameserver 100.100.100.100\nnameserver fd7a:115c:a1e0::53\nsearch ts.net\n")
	assert.Equal(t, []string{"100.100.100.100", "fd7a:115c:a1e0::53"}, parseResolvConf(data))
}

func TestParseDscacheutil(t *testing.T) {
	out := []byte("name: macbook.internal\nipv6_address: fd00::3\n\nname: macbook.internal\nip_address: 10.77.0.3\n\n")
	assert.Equal(t, []string{"fd00::3", "10.77.0.3"}, parseDscacheutil(out))
}
