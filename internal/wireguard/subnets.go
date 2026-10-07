package wireguard

import (
	"fmt"
	"net/netip"
	"slices"
	"sort"
	"strings"
)

// diffPrefixes returns what to add and what to remove to turn old into next.
func diffPrefixes(old, next []netip.Prefix) (add, remove []netip.Prefix) {
	for _, p := range next {
		if !slices.Contains(old, p) {
			add = append(add, p)
		}
	}
	for _, p := range old {
		if !slices.Contains(next, p) {
			remove = append(remove, p)
		}
	}
	return add, remove
}

func sortPrefixes(ps []netip.Prefix) []netip.Prefix {
	out := slices.Clone(ps)
	sort.Slice(out, func(i, j int) bool { return out[i].String() < out[j].String() })
	return out
}

// SetAcceptedRoutes points the OS at the mesh interface for subnets that
// peers route, and stops doing so for ones that went away. It returns the
// prefixes that could not be installed, with why.
func (e *Engine) SetAcceptedRoutes(routes []netip.Prefix) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	next := sortPrefixes(routes)
	add, remove := diffPrefixes(e.accepted, next)
	var failed []string
	for _, p := range remove {
		if err := routeDel(e.name, p); err != nil {
			failed = append(failed, err.Error())
		}
	}
	applied := slices.DeleteFunc(slices.Clone(e.accepted), func(p netip.Prefix) bool { return slices.Contains(remove, p) })
	for _, p := range add {
		if err := routeAdd(e.name, p); err != nil {
			failed = append(failed, err.Error())
			continue
		}
		applied = append(applied, p)
	}
	e.accepted = sortPrefixes(applied)
	if len(failed) > 0 {
		return fmt.Errorf("%s", strings.Join(failed, "; "))
	}
	return nil
}

// SetServedRoutes makes this device a subnet router for routes: it forwards
// what peers send to them and rewrites the source to its own address, so
// hosts on those subnets answer without knowing about the mesh. mesh are the
// network's address ranges, the only sources that get rewritten.
func (e *Engine) SetServedRoutes(routes, mesh []netip.Prefix) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	next := sortPrefixes(routes)
	if slices.Equal(next, e.served) && slices.Equal(mesh, e.servedMesh) {
		return nil
	}
	if len(next) == 0 {
		err := forwardingOff(e.name, e.served, e.servedMesh)
		e.served, e.servedMesh = nil, nil
		return err
	}
	if err := forwardingOn(e.name, next, mesh, e.served, e.servedMesh); err != nil {
		return err
	}
	e.served, e.servedMesh = next, slices.Clone(mesh)
	return nil
}

// closeRoutes undoes what SetAcceptedRoutes and SetServedRoutes did.
func (e *Engine) closeRoutes() {
	e.mu.Lock()
	defer e.mu.Unlock()
	for _, p := range e.accepted {
		_ = routeDel(e.name, p)
	}
	e.accepted = nil
	if e.exit {
		_ = exitOff(e.name)
		e.exit = false
	}
	if len(e.served) > 0 {
		_ = forwardingOff(e.name, e.served, e.servedMesh)
		e.served, e.servedMesh = nil, nil
	}
}

// SetExitNode sends all of this device's traffic that no other route claims
// through the mesh interface (its peer must route the default route), or stops.
func (e *Engine) SetExitNode(on bool) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	if on == e.exit {
		return nil
	}
	if !on {
		e.exit = false
		return exitOff(e.name)
	}
	if err := exitOn(e.name); err != nil {
		_ = exitOff(e.name)
		return err
	}
	e.exit = true
	return nil
}
