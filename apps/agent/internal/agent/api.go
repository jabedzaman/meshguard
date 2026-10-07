package agent

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/netip"
	"os"
	"regexp"
	"runtime"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/jabedzaman/meshguard/internal/acl"
	"github.com/jabedzaman/meshguard/internal/coordination"
	"github.com/jabedzaman/meshguard/internal/identity"
	"github.com/jabedzaman/meshguard/internal/ipc"
	"github.com/jabedzaman/meshguard/internal/state"
)

// Handler returns the local API routes. Serve it with ipc.ConnContext so each
// request carries its caller's peer credentials.
func (a *Agent) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /v1/status", a.handleStatus)
	mux.HandleFunc("POST /v1/up", a.handleUp)
	mux.HandleFunc("POST /v1/down", a.handleDown)
	mux.HandleFunc("POST /v1/logout", a.handleLogout)
	mux.HandleFunc("GET /v1/netcheck", a.handleNetcheck)
	mux.HandleFunc("GET /v1/access", a.handleAccess)
	mux.HandleFunc("POST /v1/cert", a.handleCert)
	mux.HandleFunc("GET /v1/prefs", a.handleGetPrefs)
	mux.HandleFunc("PATCH /v1/prefs", a.handleSetPrefs)
	return a.authorize(mux)
}

// authorize lets through only callers the kernel vouches for: root, the
// agent's own user and the operators. The socket's file mode is the first
// check; this one holds even if the socket is reachable by others (a shared
// group, a socket under /tmp). Callers with unknown credentials are refused.
func (a *Agent) authorize(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		caller, ok := ipc.CallerFrom(r.Context())
		if !ok {
			writeError(w, http.StatusForbidden, "forbidden", "couldn't identify the calling user")
			return
		}
		if !a.allowed(caller.UID) {
			slog.Warn("refused local API caller", "uid", caller.UID, "path", r.URL.Path)
			writeError(w, http.StatusForbidden, "forbidden",
				"this user may not control the meshguard agent: run with sudo, or reinstall it with sudo meshguard-agent install as this user")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (a *Agent) allowed(uid uint32) bool {
	if uid == 0 || uid == uint32(os.Geteuid()) {
		return true
	}
	return slices.Contains(a.Operators, uid)
}

func (a *Agent) handleStatus(w http.ResponseWriter, _ *http.Request) {
	a.mu.Lock()
	defer a.mu.Unlock()

	st, err := state.Load(a.StateDir)
	if errors.Is(err, state.ErrNotEnrolled) {
		writeJSON(w, http.StatusOK, ipc.Status{Version: a.Version, State: "not_enrolled"})
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "state_unreadable", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, a.statusLocked(st))
}

// handleUp enrolls with a token, or reconnects an enrolled device after down.
func (a *Agent) handleUp(w http.ResponseWriter, r *http.Request) {
	var req ipc.UpRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid request body")
		return
	}

	a.mu.Lock()
	defer a.mu.Unlock()

	st, err := state.Load(a.StateDir)
	switch {
	case err == nil && req.Token != "":
		writeError(w, http.StatusConflict, "already_enrolled",
			"this machine is already in network "+st.Network.Name+" as "+st.Device.Name+
				" (run meshguard logout first to join another)")
	case err == nil:
		// Reconnect.
		if st.Disabled {
			st.Disabled = false
			if err := state.Save(a.StateDir, st); err != nil {
				writeError(w, http.StatusInternalServerError, "state_unwritable", err.Error())
				return
			}
		}
		a.startLocked(st)
		writeJSON(w, http.StatusOK, a.statusLocked(st))
	case !errors.Is(err, state.ErrNotEnrolled):
		writeError(w, http.StatusInternalServerError, "state_unreadable", err.Error())
	case req.Token == "" || req.Server == "":
		writeError(w, http.StatusBadRequest, "not_enrolled",
			"this machine isn't in a network yet: run meshguard up --token <token>")
	default:
		a.enrollLocked(w, r, req)
	}
}

func (a *Agent) enrollLocked(w http.ResponseWriter, r *http.Request, req ipc.UpRequest) {
	keys, err := identity.Generate()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "key_generation_failed", err.Error())
		return
	}
	wgPublic, err := keys.WireGuardPublicKey()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "key_generation_failed", err.Error())
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	res, err := coordination.NewClient(req.Server).Enroll(ctx, coordination.EnrollRequest{
		Token:              req.Token,
		Hostname:           hostname(),
		Platform:           runtime.GOOS,
		IdentityPublicKey:  keys.IdentityPublicKey(),
		WireGuardPublicKey: wgPublic,
	})
	var apiErr *coordination.Error
	if errors.As(err, &apiErr) {
		writeError(w, http.StatusBadGateway, apiErr.Code, apiErr.Message)
		return
	}
	if err != nil {
		writeError(w, http.StatusBadGateway, "control_plane_unreachable", err.Error())
		return
	}

	st := state.New(req.Server, keys, res.Device, res.Network)
	if err := state.Save(a.StateDir, st); err != nil {
		// Enrolled on the server but couldn't persist the keys: the device
		// record is unusable; surface it rather than pretend success.
		writeError(w, http.StatusInternalServerError, "state_unwritable", err.Error())
		return
	}
	slog.Info("enrolled", "device", st.Device.Name, "network", st.Network.Name, "ipv4", st.Device.MeshIPv4)
	a.startLocked(st)
	writeJSON(w, http.StatusOK, a.statusLocked(st))
}

// handleDown disconnects but stays enrolled, across restarts.
func (a *Agent) handleDown(w http.ResponseWriter, _ *http.Request) {
	a.mu.Lock()
	defer a.mu.Unlock()

	st, err := state.Load(a.StateDir)
	if err != nil {
		writeError(w, http.StatusConflict, "not_enrolled", "this machine isn't in a network")
		return
	}
	st.Disabled = true
	if err := state.Save(a.StateDir, st); err != nil {
		writeError(w, http.StatusInternalServerError, "state_unwritable", err.Error())
		return
	}
	a.stopLocked()
	writeJSON(w, http.StatusOK, a.statusLocked(st))
}

// handleLogout removes the device from its network and forgets it locally.
func (a *Agent) handleLogout(w http.ResponseWriter, r *http.Request) {
	var req ipc.LogoutRequest
	_ = json.NewDecoder(r.Body).Decode(&req) // empty body is fine

	a.mu.Lock()
	defer a.mu.Unlock()

	st, err := state.Load(a.StateDir)
	if err != nil {
		writeError(w, http.StatusConflict, "not_enrolled", "this machine isn't in a network")
		return
	}

	cl, _, err := client(st)
	if err == nil {
		ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
		err = cl.DeleteSelf(ctx)
		cancel()
	}
	var apiErr *coordination.Error
	if errors.As(err, &apiErr) && apiErr.Status == http.StatusNotFound {
		err = nil // already removed on the server (e.g. from the web)
	}
	if err != nil && !req.Force {
		writeError(w, http.StatusBadGateway, "control_plane_unreachable",
			"couldn't remove this device from the network: "+err.Error()+
				" (use --force to forget it locally anyway)")
		return
	}

	a.stopLocked()
	if err := state.Remove(a.StateDir); err != nil {
		writeError(w, http.StatusInternalServerError, "state_unwritable", err.Error())
		return
	}
	slog.Info("logged out", "device", st.Device.Name, "network", st.Network.Name)
	writeJSON(w, http.StatusOK, ipc.Status{Version: a.Version, State: "not_enrolled"})
}

// handleNetcheck asks every STUN server for our public address now and
// reports what the network looks like.
func (a *Agent) handleNetcheck(w http.ResponseWriter, r *http.Request) {
	a.mu.Lock()
	c := a.conn
	var engine Engine
	var servers []string
	var relayStatus *ipc.RelayStatus
	if c != nil {
		engine, servers = c.engine, c.stun
		if c.relayClient != nil {
			relayStatus = &ipc.RelayStatus{URL: c.relayURL, Connected: c.relayClient.Connected()}
		}
	}
	a.mu.Unlock()

	if engine == nil {
		writeError(w, http.StatusConflict, "not_connected",
			"WireGuard isn't running (run meshguard up, or check meshguard status)")
		return
	}

	started := time.Now()
	sent := a.probeStun(engine, servers)
	deadline := time.After(2 * time.Second)
	for waiting := true; waiting; {
		done := true
		for _, s := range sent {
			if _, ok := a.nat.answer(s, started); !ok {
				done = false
			}
		}
		if done {
			break
		}
		select {
		case <-deadline:
			waiting = false
		case <-r.Context().Done():
			return
		case <-time.After(50 * time.Millisecond):
		}
	}

	nc := ipc.Netcheck{Stun: []ipc.StunResult{}, Relay: relayStatus}
	var publics []netip.AddrPort
	for _, s := range servers {
		res := ipc.StunResult{Server: s}
		if ans, ok := a.nat.answer(s, started); ok {
			res.Public = ans.public.String()
			res.LatencyMs = ans.latency.Milliseconds()
			publics = append(publics, ans.public)
		} else {
			res.Error = "no answer"
		}
		nc.Stun = append(nc.Stun, res)
	}
	nc.NAT = classifyNAT(publics)

	a.mu.Lock()
	if st, err := state.Load(a.StateDir); err == nil {
		var exclude []netip.Prefix
		for _, cidr := range []string{st.Network.IPv4CIDR, st.Network.IPv6CIDR} {
			if p, err := netip.ParsePrefix(cidr); err == nil {
				exclude = append(exclude, p)
			}
		}
		nc.Endpoints = a.endpoints(engine, exclude)
	}
	a.mu.Unlock()
	writeJSON(w, http.StatusOK, nc)
}

// handleAccess evaluates the access rules for a new connection from each
// peer, e.g. ?protocol=tcp&port=22 (port is ignored for icmp).
func (a *Agent) handleAccess(w http.ResponseWriter, r *http.Request) {
	proto := acl.Protocol(r.URL.Query().Get("protocol"))
	var port uint16
	switch proto {
	case acl.TCP, acl.UDP:
		n, err := strconv.ParseUint(r.URL.Query().Get("port"), 10, 16)
		if err != nil || n == 0 {
			writeError(w, http.StatusBadRequest, "bad_request", "port must be 1-65535")
			return
		}
		port = uint16(n)
	case acl.ICMP:
	default:
		writeError(w, http.StatusBadRequest, "bad_request", "protocol must be tcp, udp or icmp")
		return
	}

	a.mu.Lock()
	defer a.mu.Unlock()
	c := a.conn
	if c == nil {
		writeError(w, http.StatusConflict, "not_connected", "not connected (run meshguard up, or check meshguard status)")
		return
	}
	res := ipc.Access{Synced: !c.lastSync.IsZero(), Peers: []ipc.PeerAccess{}}
	policy := aclPolicy(c.acl)
	if st := aclStatus(c.acl, res.Synced, 0); st != nil {
		res.DefaultAction = st.DefaultAction
	}
	for _, p := range c.peers {
		pa := ipc.PeerAccess{Name: p.Name, MeshIPv4: p.MeshIPv4}
		if ip, err := netip.ParseAddr(p.MeshIPv4); err == nil && res.Synced {
			pa.Allowed = policy.Allows(ip, proto, port)
		}
		res.Peers = append(res.Peers, pa)
	}
	writeJSON(w, http.StatusOK, res)
}

var invalidHostnameChars = regexp.MustCompile(`[^A-Za-z0-9.-]+`)

// hostname returns the machine's short name (first label, so macOS's
// "Jabeds-MacBook-Air.local" becomes "Jabeds-MacBook-Air") in the form the
// control plane accepts.
func hostname() string {
	name, err := os.Hostname()
	if err != nil {
		name = "device"
	}
	return deviceName(name)
}

func deviceName(host string) string {
	name, _, _ := strings.Cut(host, ".")
	name = strings.Trim(invalidHostnameChars.ReplaceAllString(name, "-"), "-.")
	if name == "" {
		return "device"
	}
	return name
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, ipc.Error{Code: code, Message: message})
}
