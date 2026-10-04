package agent

import (
	"log/slog"
	"net/netip"

	"github.com/jabedzaman/meshguard/internal/coordination"
	"github.com/jabedzaman/meshguard/internal/dns"
	"github.com/jabedzaman/meshguard/internal/ipc"
	"github.com/jabedzaman/meshguard/internal/state"
	"github.com/jabedzaman/meshguard/internal/wireguard"
)

// dnsState is private DNS for one connection. Guarded by Agent.mu.
type dnsState struct {
	server *dns.Server
	status ipc.DNSStatus
	// Interface whose OS resolver settings to undo on disconnect.
	configuredIface string
}

// startDNSLocked answers <name>.internal and the mesh's reverse zones at
// dns.ResolverAddr inside the TUN, and points the OS resolver there for those
// zones only. Failures are reported in status; the mesh works without DNS.
// Caller holds a.mu and WireGuard is up.
func (a *Agent) startDNSLocked(c *connection, st *state.State) {
	c.dns.status = ipc.DNSStatus{Name: dns.Name(st.Device.Name)}
	var networks []netip.Prefix
	for _, cidr := range []string{st.Network.IPv4CIDR, st.Network.IPv6CIDR} {
		if p, err := netip.ParsePrefix(cidr); err == nil {
			networks = append(networks, p)
		}
	}
	server := &dns.Server{}
	server.SetRecords(dnsRecords(st.Device, nil))
	server.SetNetworks(networks)
	c.engine.SetLocalHandler(server.HandlePacket)
	c.dns.server = server
	c.dns.status.Resolver = dns.ResolverAddr.String()

	if _, real := c.engine.(*wireguard.Engine); !real {
		return // a fake engine in tests: no interface to point the OS at
	}
	iface := c.engine.Name()
	how, err := dns.ConfigureOS(iface, dns.ReverseZones(networks))
	if err != nil {
		c.dns.status.Problem = err.Error() + "; query " + dns.ResolverAddr.String() + " directly"
		slog.Warn("split dns not configured", "err", err)
		return
	}
	c.dns.configuredIface = iface
	c.dns.status.Configured = how
	slog.Info("dns serving", "addr", dns.ResolverAddr, "domain", dns.Domain, "via", how)
}

// stopDNSLocked undoes the OS resolver settings; the server goes with the
// engine. Caller holds a.mu.
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
