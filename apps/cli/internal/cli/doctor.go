package cli

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"runtime"
	"slices"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/spf13/cobra"

	"github.com/jabedzaman/meshguard/internal/ipc"
)

// Check results.
const (
	checkOK   = "ok"
	checkWarn = "warn"
	checkFail = "fail"
)

const (
	// The agent syncs every 10s; three missed syncs is a problem.
	syncStaleAfter = 30 * time.Second
	// While watching, a sync (or a watch confirming nothing changed) can be
	// a minute old.
	watchStaleAfter = 90 * time.Second
	// WireGuard keepalives (25s) renew the handshake about every 2 minutes.
	handshakeStaleAfter = 3 * time.Minute
)

// check is one line of the doctor's report.
type check struct {
	// "this device", "peers", a peer's name, or "port 8080".
	Section string `json:"section"`
	Name    string `json:"name"`
	Status  string `json:"status"`
	Detail  string `json:"detail"`
	Fix     string `json:"fix,omitempty"`
}

// probes is how the doctor looks at the machine; tests replace them.
type probes struct {
	status   func() (ipc.Status, error)
	netcheck func() (ipc.Netcheck, error)
	access   func(protocol string, port int) (ipc.Access, error)
	// resolve looks a name up through the OS resolver, as other programs do.
	resolve func(name string) ([]string, error)
	// nameservers lists /etc/resolv.conf's servers (Linux; nil elsewhere).
	nameservers func() []string
	// route returns the interface the OS sends traffic to ip through.
	route func(ip string) (string, error)
	// listeners returns the local addresses listening on a TCP port.
	listeners func(port int) ([]netip.Addr, error)
	dial      func(addr string) error
	ping      func(ip string) error
	now       func() time.Time
}

func (o *options) probes() probes {
	return probes{
		status: o.status,
		netcheck: func() (ipc.Netcheck, error) {
			var nc ipc.Netcheck
			err := o.call(http.MethodGet, "/v1/netcheck", nil, &nc)
			return nc, err
		},
		access: func(protocol string, port int) (ipc.Access, error) {
			var a ipc.Access
			err := o.call(http.MethodGet, fmt.Sprintf("/v1/access?protocol=%s&port=%d", protocol, port), nil, &a)
			return a, err
		},
		resolve:     resolveHost,
		nameservers: resolvConfNameservers,
		route:       routeInterface,
		listeners:   tcpListeners,
		dial: func(addr string) error {
			c, err := net.DialTimeout("tcp", addr, 3*time.Second)
			if err == nil {
				c.Close()
			}
			return err
		},
		ping: pingOnce,
		now:  time.Now,
	}
}

func newDoctor(o *options) *cobra.Command {
	var port int
	cmd := &cobra.Command{
		Use:   "doctor [peer]",
		Short: "Check what stands between this machine and its peers",
		Long: `Checks the agent, WireGuard, the control plane, routes, the relay, NAT,
private DNS and access rules, then every peer's handshake.

With a peer, checks the path to it: DNS, route, handshake and ping, and with
--port whether its TCP port accepts connections. With --port alone, checks
this machine's port: that something listens where peers can reach it, and
which peers the access rules let in.

Exits 1 if any check fails.`,
		Example: `  meshguard doctor                    # this machine and all peers
  meshguard doctor macbook            # the path to a peer
  meshguard doctor macbook --port 22  # ...and whether its port 22 answers
  meshguard doctor --port 8080        # can peers reach this machine's port 8080?`,
		Args: cobra.MaximumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			if port < 0 || port > 65535 {
				return errors.New("--port must be 1-65535")
			}
			target := ""
			if len(args) == 1 {
				target = args[0]
			}
			checks := runDoctor(o.probes(), target, port)
			if o.json {
				if err := printJSON(checks); err != nil {
					return err
				}
			} else {
				printDoctor(checks)
			}
			if n := countStatus(checks, checkFail); n > 0 {
				cmd.SilenceErrors = true
				return fmt.Errorf("%d checks failed", n)
			}
			return nil
		},
	}
	cmd.Flags().IntVarP(&port, "port", "p", 0, "TCP port to check: the peer's, or this machine's without a peer")
	cmd.Flags().BoolVar(&o.json, "json", false, "print JSON")
	return cmd
}

// doctor collects checks section by section.
type doctor struct {
	probes
	section string
	checks  []check
}

func (d *doctor) add(status, name, detail, fix string) {
	d.checks = append(d.checks, check{Section: d.section, Name: name, Status: status, Detail: detail, Fix: fix})
}

func runDoctor(p probes, target string, port int) []check {
	d := &doctor{probes: p}
	s, ok := d.device()
	if !ok {
		return d.checks
	}
	switch {
	case target != "":
		d.peer(s, target, port)
	case port != 0:
		d.localPort(s, port)
	default:
		d.peers(s)
	}
	return d.checks
}

// device checks this machine. ok is false when nothing past it can work.
func (d *doctor) device() (ipc.Status, bool) {
	d.section = "this device"
	s, err := d.status()
	if err != nil {
		d.add(checkFail, "agent", err.Error(), "")
		return s, false
	}
	if s.Version != Version && s.Version != "dev" && Version != "dev" {
		d.add(checkWarn, "agent", fmt.Sprintf("agent %s, cli %s", s.Version, Version),
			"install both from the same build")
	} else {
		d.add(checkOK, "agent", "running ("+s.Version+")", "")
	}

	switch s.State {
	case "not_enrolled":
		d.add(checkFail, "network", "not in a network", "meshguard up --token <token> (from the network's Add device)")
		return s, false
	case "down":
		d.add(checkFail, "network", fmt.Sprintf("%s in %s is down", s.Device.Name, s.Network.Name), "meshguard up")
		return s, false
	}
	d.add(checkOK, "network", fmt.Sprintf("%s in %s", s.Device.Name, s.Network.Name), "")

	if s.Interface == "" {
		d.add(checkFail, "wireguard", orDefault(s.Problem, "not running"),
			"run the agent as root: sudo meshguard-agent install")
		return s, false
	}
	d.add(checkOK, "wireguard", s.Interface+" up", "")

	d.controlPlane(s)
	if len(s.Peers) > 0 {
		d.routeTo(s, s.Peers[0])
	}
	d.relay(s)
	d.nat()
	d.dns(s)
	d.acl(s)
	return s, true
}

func (d *doctor) controlPlane(s ipc.Status) {
	staleAfter := syncStaleAfter
	if s.Watching {
		staleAfter = watchStaleAfter
	}
	if s.LastSyncAt == nil || d.now().Sub(*s.LastSyncAt) > staleAfter {
		detail := "never synced"
		if s.LastSyncAt != nil {
			detail = "last synced " + d.ago(*s.LastSyncAt)
		}
		d.add(checkFail, "control plane", orDefault(s.Problem, detail+" with "+s.Server),
			"peers and access rules won't update until it syncs: check this machine's internet connection and that "+s.Server+" is up")
		return
	}
	if s.Problem != "" {
		d.add(checkWarn, "control plane", s.Problem, "")
		return
	}
	detail := "synced " + d.ago(*s.LastSyncAt) + " with " + s.Server
	if s.Watching {
		detail += ", changes pushed"
	}
	d.add(checkOK, "control plane", detail, "")
}

func (d *doctor) routeTo(s ipc.Status, p ipc.Peer) {
	iface, err := d.route(p.MeshIPv4)
	switch {
	case err != nil:
		d.add(checkWarn, "route", "couldn't look up the route to "+p.MeshIPv4+": "+err.Error(), "")
	case iface != s.Interface:
		d.add(checkFail, "route", fmt.Sprintf("traffic to %s goes through %s, not %s", p.MeshIPv4, iface, s.Interface),
			"another VPN or route overlaps the mesh range: disconnect it, or give the network another range")
	default:
		d.add(checkOK, "route", "mesh traffic goes through "+iface, "")
	}
}

func (d *doctor) relay(s ipc.Status) {
	switch {
	case s.Relay == nil:
		d.add(checkWarn, "relay", "none configured",
			"peers that can't connect directly won't reach this device (set RELAY_URL on the control plane)")
	case !s.Relay.Connected:
		d.add(checkWarn, "relay", "not connected to "+s.Relay.URL,
			"peers without a direct path can't reach this device: check outbound access to the relay")
	default:
		d.add(checkOK, "relay", "connected to "+s.Relay.URL, "")
	}
}

func (d *doctor) nat() {
	nc, err := d.netcheck()
	if err != nil {
		d.add(checkWarn, "nat", "couldn't check: "+err.Error(), "")
		return
	}
	public := ""
	for _, r := range nc.Stun {
		if r.Public != "" {
			public = r.Public
			break
		}
	}
	switch {
	case len(nc.Stun) == 0:
		d.add(checkWarn, "nat", "no STUN servers configured", "set STUN_SERVERS on the control plane; until then only peers on the same network connect directly")
	case public == "":
		d.add(checkWarn, "nat", "no STUN server answered", "outbound UDP may be blocked here: peers will use the relay")
	case nc.NAT == "symmetric":
		d.add(checkWarn, "nat", "symmetric NAT (public "+public+")",
			"direct connections are unlikely from this network: peers will use the relay")
	case nc.NAT == "endpoint-independent":
		d.add(checkOK, "nat", "endpoint-independent NAT, public "+public, "")
	default:
		d.add(checkOK, "nat", "public "+public+" (one STUN server answered, NAT type unknown)", "")
	}
}

func (d *doctor) dns(s ipc.Status) {
	if s.DNS == nil {
		return
	}
	if s.DNS.Resolver == "" {
		d.add(checkWarn, "dns", orDefault(s.DNS.Problem, "the agent isn't serving DNS"), "")
		return
	}
	d.resolves("dns", s.DNS.Name, s.Device.MeshIPv4, s)
}

// resolves checks that name resolves to ip through the OS.
func (d *doctor) resolves(check, name, ip string, s ipc.Status) {
	addrs, err := d.resolve(name)
	if err == nil && slices.Contains(addrs, ip) {
		d.add(checkOK, check, name+" → "+ip, "")
		return
	}
	detail := name + " doesn't resolve through the OS"
	if err != nil {
		detail += " (" + err.Error() + ")"
	} else {
		detail += fmt.Sprintf(" (got %s, want %s)", orDefault(strings.Join(addrs, ", "), "nothing"), ip)
	}
	fix := ""
	switch {
	case s.DNS.Configured == "":
		fix = orDefault(s.DNS.Problem, "split DNS isn't set up") + "; meshguard ip <peer> works without DNS"
	case s.DNS.Configured == "systemd-resolved" && !slices.Contains(d.nameservers(), "127.0.0.53"):
		fix = "systemd-resolved has the .internal names (resolvectl query " + name + "), but /etc/resolv.conf " +
			"doesn't send programs to it: sudo ln -sf /run/systemd/resolve/stub-resolv.conf /etc/resolv.conf " +
			"(on WSL, first set generateResolvConf = false under [network] in /etc/wsl.conf)"
	case s.DNS.Configured == "systemd-resolved":
		fix = "resolvectl status " + s.Interface + " should show " + s.DNS.Resolver + " and the internal domain"
	default:
		fix = "scutil --dns should list a resolver for internal"
	}
	d.add(checkWarn, check, detail, fix)
}

func (d *doctor) acl(s ipc.Status) {
	switch {
	case s.ACL == nil:
		d.add(checkWarn, "access", "rules not synced yet: peers can't open connections to this device", "")
	case s.ACL.DefaultAction == "allow":
		d.add(checkOK, "access", "every peer may connect", "")
	case s.ACL.Rules == 0:
		d.add(checkWarn, "access", "denied by default with no rules: no peer can open connections to this device",
			"add rules on the network page if peers should reach it")
	default:
		d.add(checkOK, "access", fmt.Sprintf("only by %d rules (%d packets refused)", s.ACL.Rules, s.ACL.Dropped), "")
	}
}

func (d *doctor) peers(s ipc.Status) {
	d.section = "peers"
	if len(s.Peers) == 0 {
		d.add(checkOK, "-", "no other devices in "+s.Network.Name+" yet", "")
		return
	}
	for _, p := range s.Peers {
		d.handshake(p.Name, p)
	}
}

// handshake checks WireGuard is talking to p.
func (d *doctor) handshake(name string, p ipc.Peer) bool {
	switch {
	case p.LastHandshake == nil:
		d.add(checkWarn, name, "no handshake yet",
			"it's offline or down, or neither side can reach the other: run meshguard doctor on it")
		return false
	case d.now().Sub(*p.LastHandshake) > handshakeStaleAfter:
		d.add(checkWarn, name, "last handshake "+d.ago(*p.LastHandshake),
			"it's probably offline: run meshguard doctor on it")
		return false
	default:
		d.add(checkOK, name, path(p)+", handshake "+d.ago(*p.LastHandshake), "")
		return true
	}
}

func (d *doctor) peer(s ipc.Status, target string, port int) {
	p, err := findPeer(s.Peers, target)
	if err != nil {
		d.section = target
		d.add(checkFail, "peer", err.Error(), "")
		return
	}
	d.section = p.Name
	talking := d.handshake("wireguard", p)
	d.routeTo(s, p)
	if s.DNS != nil && s.DNS.Resolver != "" {
		d.resolves("dns", p.DNSName, p.MeshIPv4, s)
	}

	if err := d.ping(p.MeshIPv4); err == nil {
		d.add(checkOK, "ping", p.MeshIPv4+" replies", "")
	} else if talking {
		d.add(checkWarn, "ping", "WireGuard is connected but "+p.MeshIPv4+" doesn't answer pings",
			p.Name+"'s access rules may not allow ICMP from this device, or its firewall drops pings")
	} else {
		d.add(checkFail, "ping", p.MeshIPv4+" doesn't answer", "run meshguard doctor on "+p.Name)
	}

	if port == 0 {
		return
	}
	addr := net.JoinHostPort(p.MeshIPv4, strconv.Itoa(port))
	err = d.dial(addr)
	switch {
	case err == nil:
		d.add(checkOK, "port", addr+" accepts connections", "")
	case errors.Is(err, syscall.ECONNREFUSED):
		d.add(checkFail, "port", fmt.Sprintf("%s refused the connection: nothing listens on port %d there", addr, port),
			fmt.Sprintf("on %s: meshguard doctor --port %d", p.Name, port))
	default:
		d.add(checkFail, "port", addr+" didn't answer",
			fmt.Sprintf("%s's access rules may not let this device in on tcp/%d, or a firewall drops it: on %s, meshguard doctor --port %d shows who may connect",
				p.Name, port, p.Name, port))
	}
}

// localPort checks peers can reach this machine's TCP port.
func (d *doctor) localPort(s ipc.Status, port int) {
	d.section = fmt.Sprintf("port %d", port)
	mesh, _ := netip.ParseAddr(s.Device.MeshIPv4)
	addrs, err := d.listeners(port)
	reachable := slices.ContainsFunc(addrs, func(a netip.Addr) bool { return a.IsUnspecified() || a == mesh })
	switch {
	case err != nil:
		d.add(checkWarn, "listening", "couldn't list listening sockets: "+err.Error(), "")
	case len(addrs) == 0:
		d.add(checkFail, "listening", fmt.Sprintf("nothing listens on tcp/%d", port), "start the service")
	case reachable:
		d.add(checkOK, "listening", "on "+joinAddrs(addrs, port), "")
	default:
		fix := fmt.Sprintf("bind it to 0.0.0.0 or %s", s.Device.MeshIPv4)
		if slices.ContainsFunc(addrs, netip.Addr.IsLoopback) {
			fix += fmt.Sprintf(" (Docker: publish with -p %d:%d, not -p 127.0.0.1:%d:%d)", port, port, port, port)
		}
		d.add(checkFail, "listening", "only on "+joinAddrs(addrs, port)+", which peers can't reach", fix)
	}

	a, err := d.access("tcp", port)
	if err != nil {
		d.add(checkWarn, "access", "couldn't check: "+err.Error(), "")
		return
	}
	var allowed, blocked []string
	for _, p := range a.Peers {
		if p.Allowed {
			allowed = append(allowed, p.Name)
		} else {
			blocked = append(blocked, p.Name)
		}
	}
	switch {
	case !a.Synced:
		d.add(checkWarn, "access", "rules not synced yet: peers can't connect", "")
	case len(a.Peers) == 0:
		d.add(checkOK, "access", "no peers yet", "")
	case len(blocked) == 0:
		d.add(checkOK, "access", "every peer may connect", "")
	case len(allowed) == 0:
		d.add(checkWarn, "access", fmt.Sprintf("no peer may connect to tcp/%d", port),
			"add a rule on the network page")
	default:
		d.add(checkOK, "access", "allowed: "+strings.Join(allowed, ", ")+"; blocked: "+strings.Join(blocked, ", "), "")
	}
}

func (d *doctor) ago(t time.Time) string {
	return d.now().Sub(t).Round(time.Second).String() + " ago"
}

func joinAddrs(addrs []netip.Addr, port int) string {
	parts := make([]string, len(addrs))
	for i, a := range addrs {
		parts[i] = netip.AddrPortFrom(a, uint16(port)).String()
	}
	return strings.Join(parts, ", ")
}

func orDefault(s, def string) string {
	if s == "" {
		return def
	}
	return s
}

func countStatus(checks []check, status string) int {
	n := 0
	for _, c := range checks {
		if c.Status == status {
			n++
		}
	}
	return n
}

var checkMarks = map[string]string{checkOK: "✓", checkWarn: "!", checkFail: "✗"}

func printDoctor(checks []check) {
	width := 13
	for _, c := range checks {
		width = max(width, len(c.Name))
	}
	section := ""
	for _, c := range checks {
		if c.Section != section {
			if section != "" {
				fmt.Println()
			}
			section = c.Section
			fmt.Println(section)
		}
		fmt.Printf("  %s %-*s  %s\n", checkMarks[c.Status], width, c.Name, c.Detail)
		if c.Fix != "" {
			fmt.Printf("    %*s  → %s\n", width, "", c.Fix)
		}
	}
	fails, warns := countStatus(checks, checkFail), countStatus(checks, checkWarn)
	fmt.Println()
	switch {
	case fails == 0 && warns == 0:
		fmt.Println("Everything looks good.")
	default:
		fmt.Printf("%s, %s.\n", plural(fails, "problem"), plural(warns, "warning"))
	}
}

func plural(n int, word string) string {
	if n == 1 {
		return "1 " + word
	}
	return strconv.Itoa(n) + " " + word + "s"
}

// pingOnce pings once a second until a reply comes back, for up to 5s: a
// peer on Wi-Fi often loses the first ping while its radio wakes up.
func pingOnce(ip string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	args := []string{"-c", "1", "-w", "5", ip} // with -w, -c counts replies
	if runtime.GOOS == "darwin" {
		args = []string{"-o", "-t", "5", ip} // -o: stop at the first reply
	}
	return execQuiet(ctx, "ping", args...)
}
