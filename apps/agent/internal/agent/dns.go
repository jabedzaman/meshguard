package agent

import (
	"log/slog"
	"net/netip"

	"github.com/jabedzaman/meshguard/internal/coordination"
	"github.com/jabedzaman/meshguard/internal/dns"
	"github.com/jabedzaman/meshguard/internal/ipc"
	"github.com/jabedzaman/meshguard/internal/state"
)

// dnsState is private DNS for one connection. Guarded by Agent.mu.
type dnsState struct {
	server *dns.Server
	status ipc.DNSStatus
	// Interface whose OS resolver settings to undo on disconnect.
	configuredIface string
}

// startDNSLocked answers <name>.internal where this OS can reach it locally
// (dns.ListenAddr) and points the OS resolver at it for .internal only. Failures are reported in status;
// the mesh works without DNS. Caller holds a.mu and WireGuard is up.
func (a *Agent) startDNSLocked(c *connection, st *state.State) {
	c.dns.status = ipc.DNSStatus{Name: dns.Name(st.Device.Name)}
	ip, err := netip.ParseAddr(st.Device.MeshIPv4)
	if err != nil {
		c.dns.status.Problem = "no mesh IPv4 address to serve DNS on"
		return
	}
	server := &dns.Server{}
	server.SetRecords(dnsRecords(st.Device, nil))
	addr := dns.ListenAddr(ip)
	if a.dnsListen.IsValid() {
		addr = a.dnsListen
	}
	if err := server.Start(c.ctx, addr); err != nil {
		c.dns.status.Problem = "cannot serve DNS: " + err.Error()
		slog.Warn("dns unavailable", "addr", addr, "err", err)
		return
	}
	c.dns.server = server
	c.dns.status.Resolver = addr.String()

	if a.dnsListen.IsValid() {
		return // tests: leave the OS alone
	}
	iface := c.engine.Name()
	how, err := dns.ConfigureOS(iface, addr)
	if err != nil {
		c.dns.status.Problem = err.Error() + "; query " + addr.String() + " directly"
		slog.Warn("split dns not configured", "err", err)
		return
	}
	c.dns.configuredIface = iface
	c.dns.status.Configured = how
	slog.Info("dns serving", "addr", addr, "domain", dns.Domain, "via", how)
}

// stopDNSLocked undoes the OS resolver settings; the server stops with the
// connection's context. Caller holds a.mu.
func (a *Agent) stopDNSLocked(c *connection) {
	if c.dns.configuredIface != "" {
		dns.UnconfigureOS(c.dns.configuredIface)
		c.dns.configuredIface = ""
	}
}

// updateDNSLocked applies the network map's names. Caller holds a.mu.
func (a *Agent) updateDNSLocked(c *connection, nm *coordination.NetworkMap) {
	if nm.Self.Name != "" {
		c.dns.status.Name = dns.Name(nm.Self.Name)
	}
	if c.dns.server != nil {
		c.dns.server.SetRecords(dnsRecords(nm.Self, nm.Peers))
	}
}

func dnsRecords(self state.Device, peers []coordination.Peer) map[string]dns.Record {
	records := map[string]dns.Record{}
	add := func(name, v4, v6 string) {
		if name == "" {
			return
		}
		var r dns.Record
		r.IPv4, _ = netip.ParseAddr(v4)
		r.IPv6, _ = netip.ParseAddr(v6)
		records[name] = r
	}
	for _, p := range peers {
		add(p.Name, p.MeshIPv4, p.MeshIPv6)
	}
	add(self.Name, self.MeshIPv4, self.MeshIPv6)
	return records
}
