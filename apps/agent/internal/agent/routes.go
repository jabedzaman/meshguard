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
}

// planRoutes decides which subnets to serve and accept. A subnet two peers
// both route goes to the first in the map (the oldest device), and one that
// overlaps the mesh or a network this machine is on is skipped, so a laptop
// on the router's own LAN keeps using that LAN directly.
func planRoutes(nm *coordination.NetworkMap, accept bool, mesh, local []netip.Prefix) routePlan {
	plan := routePlan{byPeer: map[string][]netip.Prefix{}}
	for _, raw := range nm.Self.Routes {
		if p, err := netip.ParsePrefix(raw); err == nil {
			plan.serve = append(plan.serve, p.Masked())
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
