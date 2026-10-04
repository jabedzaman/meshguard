package agent

import (
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/jabedzaman/meshguard/internal/ipc"
	"github.com/jabedzaman/meshguard/internal/state"
)

func stateLoad(a *Agent) (*state.State, error)  { return state.Load(a.StateDir) }
func stateSave(a *Agent, st *state.State) error { return state.Save(a.StateDir, st) }

// callRaw GETs path as the agent's own user.
func callRaw(t *testing.T, h http.Handler, path string) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, path, nil)
	h.ServeHTTP(rec, req.WithContext(ipc.WithCaller(req.Context(), ipc.Caller{UID: uint32(os.Geteuid())})))
	return rec
}
