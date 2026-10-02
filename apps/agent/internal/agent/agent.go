// Package agent implements the local API the desktop app and CLI use.
package agent

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"regexp"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/twinlabshq/mesh/internal/coordination"
	"github.com/twinlabshq/mesh/internal/identity"
	"github.com/twinlabshq/mesh/internal/ipc"
	"github.com/twinlabshq/mesh/internal/state"
)

// Agent serves the local API and owns the device's state.
type Agent struct {
	Version  string
	StateDir string

	mu sync.Mutex // serializes enrollment and state access
}

// Handler returns the local API routes.
func (a *Agent) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /v1/status", a.handleStatus)
	mux.HandleFunc("POST /v1/up", a.handleUp)
	return mux
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
	writeJSON(w, http.StatusOK, statusFromState(a.Version, st))
}

func (a *Agent) handleUp(w http.ResponseWriter, r *http.Request) {
	var req ipc.UpRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Token == "" || req.Server == "" {
		writeError(w, http.StatusBadRequest, "bad_request", "token and server are required")
		return
	}

	a.mu.Lock()
	defer a.mu.Unlock()

	if st, err := state.Load(a.StateDir); err == nil {
		writeError(w, http.StatusConflict, "already_enrolled",
			"this machine is already in network "+st.Network.Name+" as "+st.Device.Name)
		return
	}

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
	writeJSON(w, http.StatusOK, statusFromState(a.Version, st))
}

func statusFromState(version string, st *state.State) ipc.Status {
	return ipc.Status{
		Version: version,
		State:   "enrolled",
		Server:  st.ServerURL,
		Device: &ipc.Device{
			ID: st.Device.ID, Name: st.Device.Name,
			MeshIPv4: st.Device.MeshIPv4, MeshIPv6: st.Device.MeshIPv6,
		},
		Network: &ipc.Network{ID: st.Network.ID, Name: st.Network.Name},
	}
}

var invalidHostnameChars = regexp.MustCompile(`[^A-Za-z0-9.-]+`)

// hostname returns the machine name in the form the control plane accepts.
func hostname() string {
	name, err := os.Hostname()
	if err != nil {
		name = "device"
	}
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
