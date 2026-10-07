package agent

import (
	"log/slog"
	"net"
	"net/netip"
	"strings"

	"github.com/jabedzaman/meshguard/internal/coordination"
)

// routePlan is what the network map asks of this device for subnet routes.
type routePlan struct {
	// serve are the subnets this device routes for its peers.
	serve []netip.Prefix
	// accepted are the peers' subnets this device sends through the mesh, and
	// byPeer the same per peer id (they join the peer's allowed IPs).
	accepted []netip.Prefix
	byPeer   map[string][]netip.Prefix
	// exitPeer is the name of the peer all other traffic goes through, once
	// it offers an approved exit node; exitProblem says why a chosen one isn't used.
	exitPeer    string
	exitProblem string
	// hosted are the service addresses this device serves itself; the others
	// join their host's allowed IPs (in byPeer) so packets to them reach it.
	hosted []netip.Addr
}

var defaultRoutes = []netip.Prefix{netip.MustParsePrefix("0.0.0.0/0"), netip.MustParsePrefix("::/0")}

// planRoutes decides which subnets to serve and accept. A subnet two peers
// both route goes to the first in the map (the oldest device), and one that
// overlaps the mesh or a network this machine is on is skipped, so a laptop
// on the router's own LAN keeps using that LAN directly.
func planRoutes(nm *coordination.NetworkMap, accept bool, exitNode string, mesh, local []netip.Prefix) routePlan {
	plan := routePlan{byPeer: map[string][]netip.Prefix{}}
	for _, raw := range nm.Self.Routes {
		if p, err := netip.ParsePrefix(raw); err == nil {
			plan.serve = append(plan.serve, p.Masked())
		}
	}
	if exitNode != "" {
		planExitNode(&plan, nm, exitNode)
	}
	for _, s := range nm.Services {
		vip, err := netip.ParseAddr(s.VIP)
		if err != nil {
			continue
		}
		if s.Hosting {
			plan.hosted = append(plan.hosted, vip)
		}
		if s.HostID != nil {
			plan.byPeer[*s.HostID] = append(plan.byPeer[*s.HostID], netip.PrefixFrom(vip, vip.BitLen()))
		}
	}
	if !accept {
		return plan
	}
	claimed := map[netip.Prefix]bool{}
	for _, peer := range nm.Peers {
		for _, raw := range peer.Routes {
			p, err := netip.ParsePrefix(raw)
			if err != nil {
				continue
			}
			p = p.Masked()
			if p.Bits() == 0 {
				continue // an exit node, chosen with --exit-node
			}
			if claimed[p] || overlapsAny(p, mesh) || overlapsAny(p, local) {
				if overlapsAny(p, local) {
					slog.Debug("not routing a subnet this machine is on", "route", p, "peer", peer.Name)
				}
				continue
			}
			claimed[p] = true
			plan.accepted = append(plan.accepted, p)
			plan.byPeer[peer.ID] = append(plan.byPeer[peer.ID], p)
		}
	}
	return plan
}

func overlapsAny(p netip.Prefix, others []netip.Prefix) bool {
	for _, o := range others {
		if o.Overlaps(p) {
			return true
		}
	}
	return false
}

// localNetworks are the subnets of this machine's own interfaces, except the
// mesh interface.
func localNetworks(skip string) []netip.Prefix {
	ifaces, err := net.Interfaces()
	if err != nil {
		return nil
	}
	var out []netip.Prefix
	for _, iface := range ifaces {
		if iface.Name == skip || iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, _ := iface.Addrs()
		for _, addr := range addrs {
			if p, err := netip.ParsePrefix(addr.String()); err == nil {
				out = append(out, p.Masked())
			}
		}
	}
	return out
}

// applyRoutes installs the plan on the engine. It returns a problem for the
// status line, empty on success.
func (a *Agent) applyRoutes(engine Engine, plan routePlan, mesh []netip.Prefix) string {
	var problems []string
	if err := engine.SetServedRoutes(plan.serve, mesh); err != nil {
		problems = append(problems, "cannot route subnets: "+err.Error())
	}
	if err := engine.SetAcceptedRoutes(plan.accepted); err != nil {
		problems = append(problems, "cannot add subnet routes: "+err.Error())
	}
	if err := engine.SetExitNode(plan.exitPeer != ""); err != nil {
		problems = append(problems, "cannot use the exit node: "+err.Error())
	}
	engine.SetServiceAddresses(plan.hosted)
	if plan.exitProblem != "" {
		problems = append(problems, plan.exitProblem)
	}
	return strings.Join(problems, "; ")
}

func routeStrings(ps []netip.Prefix) []string {
	if len(ps) == 0 {
		return nil
	}
	out := make([]string, len(ps))
	for i, p := range ps {
		out[i] = p.String()
	}
	return out
}

// planExitNode finds the peer the user chose (by name or mesh address) and, if
// it offers the default routes with approval, adds them to its allowed IPs.
func planExitNode(plan *routePlan, nm *coordination.NetworkMap, want string) {
	for _, peer := range nm.Peers {
		if !strings.EqualFold(peer.Name, want) && peer.MeshIPv4 != want && peer.MeshIPv6 != want {
			continue
		}
		var offered []netip.Prefix
		for _, raw := range peer.Routes {
			if p, err := netip.ParsePrefix(raw); err == nil && p.Bits() == 0 {
				offered = append(offered, p.Masked())
			}
		}
		if len(offered) == 0 {
			plan.exitProblem = "exit node " + want + " isn't offering to route everything, or an owner or admin hasn't approved it yet"
			return
		}
		plan.byPeer[peer.ID] = append(plan.byPeer[peer.ID], offered...)
		plan.exitPeer = peer.Name
		return
	}
	plan.exitProblem = "exit node " + want + " isn't a device this device can see"
}
