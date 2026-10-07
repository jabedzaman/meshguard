package agent

import (
	"encoding/json"
	"net/http"
	"slices"
	"strings"

	"github.com/jabedzaman/meshguard/internal/ipc"
	"github.com/jabedzaman/meshguard/internal/routing"
	"github.com/jabedzaman/meshguard/internal/state"
)

func prefsStatus(p state.Prefs) *ipc.Prefs {
	routes := p.AdvertiseRoutes
	if routes == nil {
		routes = []string{}
	}
	serve := make([]ipc.ServeRule, len(p.Serve))
	for i, r := range p.Serve {
		serve[i] = ipc.ServeRule{Port: r.Port, Target: r.Target}
	}
	return &ipc.Prefs{AdvertiseRoutes: routes, AcceptRoutes: p.AcceptRoutes, AdvertiseExitNode: p.AdvertiseExitNode, ExitNode: p.ExitNode, Serve: serve}
}

func (a *Agent) handleGetPrefs(w http.ResponseWriter, _ *http.Request) {
	a.mu.Lock()
	defer a.mu.Unlock()
	st, err := state.Load(a.StateDir)
	if err != nil {
		writeError(w, http.StatusConflict, "not_enrolled", "this machine isn't in a network")
		return
	}
	writeJSON(w, http.StatusOK, prefsStatus(st.Prefs))
}

// handleSetPrefs changes the device's settings, saves them and, while
// connected, applies them and syncs so the control plane hears at once.
func (a *Agent) handleSetPrefs(w http.ResponseWriter, r *http.Request) {
	var req ipc.PrefsUpdate
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid request body")
		return
	}

	a.mu.Lock()
	defer a.mu.Unlock()
	st, err := state.Load(a.StateDir)
	if err != nil {
		writeError(w, http.StatusConflict, "not_enrolled", "this machine isn't in a network")
		return
	}

	next := st.Prefs
	if req.AdvertiseRoutes != nil {
		routes, err := routing.ParsePrefixes(*req.AdvertiseRoutes, meshPrefixes(st))
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid_route", err.Error())
			return
		}
		next.AdvertiseRoutes = routing.Strings(routes)
	}
	if req.AcceptRoutes != nil {
		next.AcceptRoutes = *req.AcceptRoutes
	}
	if req.Serve != nil {
		rules, err := validateServe(*req.Serve)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid_serve", err.Error())
			return
		}
		next.Serve = rules
	}
	if req.AdvertiseExitNode != nil {
		next.AdvertiseExitNode = *req.AdvertiseExitNode
	}
	if req.ExitNode != nil {
		next.ExitNode = strings.TrimSpace(*req.ExitNode)
		if next.ExitNode != "" && strings.EqualFold(next.ExitNode, st.Device.Name) {
			writeError(w, http.StatusBadRequest, "invalid_exit_node", "a device can't be its own exit node")
			return
		}
	}
	if slices.Equal(next.AdvertiseRoutes, st.Prefs.AdvertiseRoutes) && next.AcceptRoutes == st.Prefs.AcceptRoutes &&
		next.AdvertiseExitNode == st.Prefs.AdvertiseExitNode && next.ExitNode == st.Prefs.ExitNode &&
		slices.Equal(next.Serve, st.Prefs.Serve) {
		writeJSON(w, http.StatusOK, prefsStatus(next))
		return
	}

	st.Prefs = next
	if err := state.Save(a.StateDir, st); err != nil {
		writeError(w, http.StatusInternalServerError, "state_unwritable", err.Error())
		return
	}
	if c := a.conn; c != nil {
		c.prefs = next
		if c.serve != nil {
			c.serve.set(next.Serve)
		}
		select {
		case c.syncNow <- struct{}{}:
		default:
		}
	}
	writeJSON(w, http.StatusOK, prefsStatus(next))
}
