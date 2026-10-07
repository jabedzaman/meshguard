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
	// The network's domain, e.g. "brave-otter.mesh.jabed.dev"; empty until the
	// control plane sends one.
	domain string
	// The device's name, for status.
	name string
	// Where the OS sends the network's zones; invalid until it's set up.
	resolver netip.Addr
	networks []netip.Prefix
	// Interface whose OS resolver settings to undo on disconnect.
	configuredIface string
}

// startDNSLocked answers <name>.<network domain> and the mesh's reverse zones
// at the network's dns.ResolverAddr inside the TUN, and points the OS resolver
// there for those zones only. Failures are reported in status; the mesh works
// without DNS. Caller holds a.mu and WireGuard is up.
func (a *Agent) startDNSLocked(c *connection, st *state.State) {
	c.dns.name, c.dns.domain = st.Device.Name, st.Network.DNSDomain
	c.dns.status = ipc.DNSStatus{Name: dns.Name(c.dns.name, c.dns.domain), Domain: c.dns.domain}
	for _, cidr := range []string{st.Network.IPv4CIDR, st.Network.IPv6CIDR} {
		if p, err := netip.ParsePrefix(cidr); err == nil {
			c.dns.networks = append(c.dns.networks, p)
		}
	}
	server := &dns.Server{}
	server.SetRecords(dnsRecords(st.Device, nil, nil))
	server.SetNetworks(c.dns.networks)
	server.SetDomain(c.dns.domain)
	resolver := server.Addr()
	if !resolver.IsValid() {
		c.dns.status.Problem = "the network's IPv4 range has no room for a DNS resolver"
		return
	}
	c.engine.SetLocalHandler(server.HandlePacket)
	c.dns.server = server
	c.dns.resolver = resolver
	c.dns.status.Resolver = resolver.String()
	a.configureOSDNSLocked(c)
}

// configureOSDNSLocked points the OS at the resolver for the network's
// domain and reverse zones, replacing what it set up before. Caller holds a.mu.
func (a *Agent) configureOSDNSLocked(c *connection) {
	if _, real := c.engine.(*wireguard.Engine); !real {
		return // a fake engine in tests: no interface to point the OS at
	}
	if c.dns.domain == "" {
		c.dns.status.Problem = "waiting for the network's domain from the control plane"
		return
	}
	iface := c.engine.Name()
	how, err := dns.ConfigureOS(iface, c.dns.resolver, c.dns.domain, dns.ReverseZones(c.dns.networks))
	if err != nil {
		c.dns.status.Configured = ""
		c.dns.status.Problem = err.Error() + "; query " + c.dns.resolver.String() + " directly"
		slog.Warn("split dns not configured", "err", err)
		return
	}
	c.dns.configuredIface = iface
	c.dns.status.Configured = how
	c.dns.status.Problem = ""
	slog.Info("dns serving", "addr", c.dns.resolver, "domain", c.dns.domain, "via", how)
}

// stopDNSLocked undoes the OS resolver settings; the server goes with the
// engine. Caller holds a.mu.
func (a *Agent) stopDNSLocked(c *connection) {
	if c.dns.configuredIface != "" {
		dns.UnconfigureOS(c.dns.configuredIface)
		c.dns.configuredIface = ""
	}
}

// updateDNSLocked applies the network map's names and domain. Caller holds a.mu.
func (a *Agent) updateDNSLocked(c *connection, nm *coordination.NetworkMap) {
	if nm.Self.Name != "" {
		c.dns.name = nm.Self.Name
	}
	domainChanged := nm.Network.DNSDomain != "" && nm.Network.DNSDomain != c.dns.domain
	if domainChanged {
		slog.Info("dns domain changed", "from", c.dns.domain, "to", nm.Network.DNSDomain)
		c.dns.domain = nm.Network.DNSDomain
		c.dns.status.Domain = c.dns.domain
	}
	c.dns.status.Name = dns.Name(c.dns.name, c.dns.domain)
	if c.dns.server == nil {
		return
	}
	c.dns.server.SetRecords(dnsRecords(nm.Self.Device, nm.Peers, nm.Services))
	if domainChanged {
		c.dns.server.SetDomain(c.dns.domain)
		a.configureOSDNSLocked(c)
	}
}

func dnsRecords(self state.Device, peers []coordination.Peer, services []coordination.Service) map[string]dns.Record {
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
	// A service answers at <name>.svc.<domain> with its address.
	for _, s := range services {
		add(s.Name+".svc", s.VIP, "")
	}
	return records
}
