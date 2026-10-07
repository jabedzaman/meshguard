package agent

import (
	"context"
	"log/slog"
	"net"
	"net/netip"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/jabedzaman/meshguard/internal/coordination"
	"github.com/jabedzaman/meshguard/internal/dns"
	"github.com/jabedzaman/meshguard/internal/ipc"
	"github.com/jabedzaman/meshguard/internal/state"
	"github.com/jabedzaman/meshguard/internal/wireguard"
)

// App connectors send the traffic for some domains through a chosen device.
// On a client the agent's resolver forwards those domains' queries to the
// device that hosts the connector, learns the addresses it answers and routes
// them through that device (allowed IPs and OS routes, for as long as the
// answers are good). The host's agent answers such queries from peers for the
// connector's domains only, resolving them with the system resolver, and
// forwards what peers then send to exactly those addresses.

const (
	// connectorRouteLifetime is how long a learned address stays routed after
	// the last answer that named it.
	connectorRouteLifetime = 5 * time.Minute
	// connectorAllowLifetime is how long a host forwards to an address it
	// resolved: longer than clients keep the route, so it never cuts one off.
	connectorAllowLifetime = 2 * connectorRouteLifetime
	connectorQueryTimeout  = 3 * time.Second
	connectorPrune         = 30 * time.Second
	// maxLearnedRoutes bounds the routes learned per connection.
	maxLearnedRoutes = 4096
)

// dynamicRoutes are addresses learned from connectors' answers.
type dynamicRoutes struct {
	mu      sync.Mutex
	entries map[netip.Addr]dynamicEntry
	now     func() time.Time
}

type dynamicEntry struct {
	peerID string
	until  time.Time
}

func newDynamicRoutes() *dynamicRoutes {
	return &dynamicRoutes{entries: map[netip.Addr]dynamicEntry{}, now: time.Now}
}

// learn routes addrs through peerID; it reports whether the set of routes changed.
func (d *dynamicRoutes) learn(peerID string, addrs []netip.Addr, lifetime time.Duration) bool {
	d.mu.Lock()
	defer d.mu.Unlock()
	changed := false
	until := d.now().Add(lifetime)
	for _, addr := range addrs {
		addr = addr.Unmap()
		old, ok := d.entries[addr]
		if !ok && len(d.entries) >= maxLearnedRoutes {
			continue
		}
		if !ok || old.peerID != peerID {
			changed = true
		}
		d.entries[addr] = dynamicEntry{peerID: peerID, until: until}
	}
	return changed
}

// prune forgets expired routes and reports whether any went.
func (d *dynamicRoutes) prune() bool {
	d.mu.Lock()
	defer d.mu.Unlock()
	now := d.now()
	changed := false
	for addr, e := range d.entries {
		if !now.Before(e.until) {
			delete(d.entries, addr)
			changed = true
		}
	}
	return changed
}

// dropPeers forgets routes through peers that are no longer connectors' hosts.
func (d *dynamicRoutes) keepOnly(peerIDs map[string]bool) bool {
	d.mu.Lock()
	defer d.mu.Unlock()
	changed := false
	for addr, e := range d.entries {
		if !peerIDs[e.peerID] {
			delete(d.entries, addr)
			changed = true
		}
	}
	return changed
}

// byPeer returns the learned routes per peer, as host prefixes.
func (d *dynamicRoutes) byPeer() map[string][]netip.Prefix {
	d.mu.Lock()
	defer d.mu.Unlock()
	out := map[string][]netip.Prefix{}
	for addr, e := range d.entries {
		out[e.peerID] = append(out[e.peerID], netip.PrefixFrom(addr, addr.BitLen()))
	}
	for _, ps := range out {
		slices.SortFunc(ps, func(a, b netip.Prefix) int { return strings.Compare(a.String(), b.String()) })
	}
	return out
}

func (d *dynamicRoutes) count(peerID string) int {
	d.mu.Lock()
	defer d.mu.Unlock()
	n := 0
	for _, e := range d.entries {
		if e.peerID == peerID {
			n++
		}
	}
	return n
}

// connectorState is one connection's app connector handling. Guarded by Agent.mu.
type connectorState struct {
	// forwards maps the domains this device sends to a peer to that peer's
	// mesh address and id, from the last network map.
	forwards []connectorForward
	// hosted are the domains this device connects for its peers.
	hosted []string
	server *connectorServer
}

type connectorForward struct {
	domain string
	peerID string
	addr   netip.Addr
}

// startConnectorsLocked prepares the learned routes and starts pruning them.
// Caller holds a.mu and WireGuard is up.
func (a *Agent) startConnectorsLocked(c *connection) {
	c.dyn = newDynamicRoutes()
	go func() {
		ticker := time.NewTicker(connectorPrune)
		defer ticker.Stop()
		for {
			select {
			case <-c.ctx.Done():
				return
			case <-ticker.C:
				if c.dyn.prune() {
					a.reapply(c)
				}
			}
		}
	}()
}

func (a *Agent) stopConnectorsLocked(c *connection) {
	if c.connectors.server != nil {
		c.connectors.server.close()
		c.connectors.server = nil
	}
}

// updateConnectorsLocked applies the network map's connectors: the domains to
// forward to peers, the ones this device hosts, and the DNS pieces for both.
// Caller holds a.mu.
func (a *Agent) updateConnectorsLocked(c *connection, nm *coordination.NetworkMap) {
	if c.engine == nil || c.dyn == nil {
		return
	}
	var forwards []connectorForward
	var hosted []string
	hostPeers := map[string]bool{}
	for _, cn := range nm.Connectors {
		domains := normalizeDomains(cn.Domains)
		if cn.Hosting {
			hosted = append(hosted, domains...)
			continue
		}
		if cn.HostID == nil {
			continue
		}
		for _, p := range nm.Peers {
			if p.ID != *cn.HostID {
				continue
			}
			if addr, err := netip.ParseAddr(p.MeshIPv4); err == nil {
				for _, d := range domains {
					forwards = append(forwards, connectorForward{domain: d, peerID: p.ID, addr: addr})
				}
				hostPeers[p.ID] = true
			}
		}
	}
	slices.Sort(hosted)
	hosted = slices.Compact(hosted)
	slices.SortFunc(forwards, func(a, b connectorForward) int { return strings.Compare(a.domain, b.domain) })
	c.connectors.hosted = hosted
	c.connectors.forwards = forwards

	// Routes learned through peers that no longer host anything go away.
	if c.dyn.keepOnly(hostPeers) {
		go a.reapply(c)
	}

	// Client side: the resolver forwards the domains, and so does the OS.
	domains := make([]string, len(forwards))
	for i, f := range forwards {
		domains[i] = f.domain
	}
	if c.dns.server != nil {
		if len(domains) == 0 {
			c.dns.server.SetForwarder(nil, nil, nil)
		} else {
			c.dns.server.SetForwarder(domains, func(q []byte) []byte { return a.forwardQuery(c, q) }, c.engine.InjectToOS)
		}
		if !slices.Equal(domains, c.dns.forwarded) {
			c.dns.forwarded = domains
			a.configureOSDNSLocked(c)
		}
	}

	// Host side: answer peers' queries for the hosted domains.
	a.syncConnectorServerLocked(c)
}

func normalizeDomains(in []string) []string {
	out := make([]string, 0, len(in))
	for _, d := range in {
		if d = strings.ToLower(strings.TrimSuffix(strings.TrimSpace(d), ".")); d != "" {
			out = append(out, d)
		}
	}
	return out
}

// forwardQuery sends a client's query for a connector's domain to the peer that
// hosts it, learns the addresses in the answer and routes them through that peer.
func (a *Agent) forwardQuery(c *connection, query []byte) []byte {
	name, ok := dns.QuestionName(query)
	if !ok {
		return nil
	}
	a.mu.Lock()
	var target *connectorForward
	for i := range c.connectors.forwards {
		f := &c.connectors.forwards[i]
		if dns.MatchDomain(name, []string{f.domain}) && (target == nil || len(f.domain) > len(target.domain)) {
			target = f
		}
	}
	var chosen connectorForward
	if target != nil {
		chosen = *target
	}
	a.mu.Unlock()
	if target == nil {
		return nil
	}

	response, err := exchangeUDP(c.ctx, netip.AddrPortFrom(chosen.addr, 53), query)
	if err != nil {
		slog.Debug("connector query failed", "name", name, "host", chosen.addr, "err", err)
		return nil
	}
	if addrs, _, ok := dns.ResponseAddrs(response); ok && len(addrs) > 0 {
		if c.dyn.learn(chosen.peerID, addrs, connectorRouteLifetime) {
			slog.Info("routing a connector's addresses", "name", name, "addrs", addrs)
			a.reapply(c)
		}
	}
	return response
}

// exchangeUDP sends one query to server over the mesh and reads the answer.
func exchangeUDP(ctx context.Context, server netip.AddrPort, query []byte) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, connectorQueryTimeout)
	defer cancel()
	var d net.Dialer
	conn, err := d.DialContext(ctx, "udp", server.String())
	if err != nil {
		return nil, err
	}
	defer conn.Close()
	deadline, _ := ctx.Deadline()
	_ = conn.SetDeadline(deadline)
	if _, err := conn.Write(query); err != nil {
		return nil, err
	}
	buf := make([]byte, 4096)
	n, err := conn.Read(buf)
	if err != nil {
		return nil, err
	}
	return buf[:n], nil
}

// reapply sets WireGuard's peers and the OS routes again from the last network
// map, after the learned routes changed.
func (a *Agent) reapply(c *connection) {
	a.mu.Lock()
	engine, nm, prefs, exclude := c.engine, c.lastMap, c.prefs, c.exclude
	if !a.current(c) || engine == nil || nm == nil {
		a.mu.Unlock()
		return
	}
	a.mu.Unlock()

	plan, applyErr, routeProblem := a.applyMap(c, engine, nm, prefs, exclude)

	a.mu.Lock()
	defer a.mu.Unlock()
	if !a.current(c) {
		return
	}
	c.accepted, c.serving, c.exitNode = routeStrings(plan.accepted), routeStrings(plan.serve), plan.exitPeer
	c.routeProblem = routeProblem
	if applyErr != nil {
		slog.Warn("cannot apply peers", "err", applyErr)
	}
}

// applyMap configures WireGuard from a network map: peers with their allowed
// IPs (their mesh addresses, approved routes, the exit node, services and
// addresses learned from connectors), access rules and subnet routes.
func (a *Agent) applyMap(c *connection, engine Engine, nm *coordination.NetworkMap, prefs state.Prefs, exclude []netip.Prefix) (routePlan, error, string) {
	plan := planRoutes(nm, prefs.AcceptRoutes, prefs.ExitNode, exclude, localNetworks(engine.Name()))
	for peerID, learned := range c.dyn.byPeer() {
		plan.byPeer[peerID] = append(plan.byPeer[peerID], learned...)
		plan.accepted = append(plan.accepted, learned...)
	}
	peers := make([]wireguard.Peer, 0, len(nm.Peers))
	for _, p := range nm.Peers {
		peer := wireguard.Peer{PublicKey: p.WireGuardPublicKey}
		for _, addr := range []string{p.MeshIPv4, p.MeshIPv6} {
			if prefix, err := wireguard.HostPrefix(addr); err == nil {
				peer.AllowedIPs = append(peer.AllowedIPs, prefix)
			}
		}
		peer.AllowedIPs = append(peer.AllowedIPs, plan.byPeer[p.ID]...)
		// The bind picks direct or relay per packet; WireGuard
		// only ever sees the peer.
		if key, err := peerKey(p.WireGuardPublicKey); err == nil {
			peer.Endpoint = wireguard.PeerEndpointString(key)
		}
		peers = append(peers, peer)
	}
	changed, err := engine.SetPeers(peers)
	if changed {
		slog.Info("peers updated", "count", len(peers))
	}
	engine.SetACL(aclPolicy(nm.ACL))
	return plan, err, a.applyRoutes(engine, plan, exclude)
}

// connectorStatusLocked lists the connectors for status. Caller holds a.mu.
func (c *connection) connectorStatusLocked() []ipc.ConnectorStatus {
	if c.lastMap == nil {
		return nil
	}
	var out []ipc.ConnectorStatus
	for _, cn := range c.lastMap.Connectors {
		s := ipc.ConnectorStatus{Name: cn.Name, Domains: cn.Domains, Hosting: cn.Hosting}
		if cn.HostID != nil {
			for _, p := range c.lastMap.Peers {
				if p.ID == *cn.HostID {
					s.Host = p.Name
					if c.dyn != nil {
						s.Routes = c.dyn.count(p.ID)
					}
				}
			}
		}
		out = append(out, s)
	}
	return out
}

// A connectorServer answers peers' queries for the domains this device
// connects, on its mesh address, with the system resolver.
type connectorServer struct {
	conn    net.PacketConn
	engine  Engine
	lookup  dns.Lookup
	mu      sync.RWMutex
	domains []string
	slots   chan struct{}
}

func (a *Agent) syncConnectorServerLocked(c *connection) {
	hosted := c.connectors.hosted
	if len(hosted) == 0 {
		if c.connectors.server != nil {
			c.connectors.server.close()
			c.connectors.server = nil
		}
		return
	}
	if c.connectors.server != nil {
		c.connectors.server.setDomains(hosted)
		return
	}
	st, err := state.Load(a.StateDir)
	if err != nil {
		return
	}
	addr, err := netip.ParseAddr(st.Device.MeshIPv4)
	if err != nil {
		return
	}
	conn, err := net.ListenPacket("udp4", netip.AddrPortFrom(addr, 53).String())
	if err != nil {
		slog.Warn("app connector cannot listen for DNS", "addr", addr, "err", err)
		c.routeProblem = "app connector cannot listen on " + addr.String() + ":53: " + err.Error()
		return
	}
	s := &connectorServer{conn: conn, engine: c.engine, lookup: dns.SystemLookup, domains: hosted, slots: make(chan struct{}, 64)}
	c.connectors.server = s
	slog.Info("app connector resolving", "domains", hosted)
	go s.serve(c.ctx)
}

func (s *connectorServer) setDomains(d []string) {
	s.mu.Lock()
	s.domains = d
	s.mu.Unlock()
}

func (s *connectorServer) close() { s.conn.Close() }

func (s *connectorServer) serve(ctx context.Context) {
	buf := make([]byte, 4096)
	for {
		n, from, err := s.conn.ReadFrom(buf)
		if err != nil {
			return
		}
		query := append([]byte(nil), buf[:n]...)
		select {
		case s.slots <- struct{}{}:
		default:
			continue // too many lookups at once: the client retries
		}
		go func() {
			defer func() { <-s.slots }()
			s.mu.RLock()
			domains := s.domains
			s.mu.RUnlock()
			lookupCtx, cancel := context.WithTimeout(ctx, 4*time.Second)
			defer cancel()
			response, learned, err := dns.AnswerConnectorQuery(lookupCtx, query, domains, s.lookup)
			if err != nil || response == nil {
				return
			}
			if len(learned) > 0 {
				s.engine.AllowForwardTo(learned, connectorAllowLifetime)
			}
			_, _ = s.conn.WriteTo(response, from)
		}()
	}
}
