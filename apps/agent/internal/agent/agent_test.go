package agent

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/twinlabshq/mesh/internal/coordination"
	"github.com/twinlabshq/mesh/internal/ipc"
)

// fakeControlPlane accepts token "good" once, like the real API.
func fakeControlPlane(t *testing.T) (url string, enrolled *[]coordination.EnrollRequest) {
	t.Helper()
	var requests []coordination.EnrollRequest
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req coordination.EnrollRequest
		require.NoError(t, json.NewDecoder(r.Body).Decode(&req))
		if req.Token != "good" || len(requests) > 0 {
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = w.Write([]byte(`{"error":{"code":"invalid_enrollment_token","message":"Enrollment token is invalid, expired, revoked or already used"}}`))
			return
		}
		requests = append(requests, req)
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"device":{"id":"d1","name":"` + req.Hostname + `","meshIpv4":"10.77.0.9","meshIpv6":"fd00:1:2:0::9"},"network":{"id":"n1","name":"home"}}`))
	}))
	t.Cleanup(srv.Close)
	return srv.URL, &requests
}

func call(t *testing.T, h http.Handler, method, path string, body any) (*httptest.ResponseRecorder, ipc.Status, ipc.Error) {
	t.Helper()
	var buf bytes.Buffer
	if body != nil {
		require.NoError(t, json.NewEncoder(&buf).Encode(body))
	}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(method, path, &buf)
	h.ServeHTTP(rec, req.WithContext(ipc.WithCaller(req.Context(), ipc.Caller{UID: uint32(os.Geteuid())})))
	var status ipc.Status
	var apiErr ipc.Error
	if rec.Code < 300 {
		require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &status))
	} else {
		require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &apiErr))
	}
	return rec, status, apiErr
}

func TestUpThenStatus(t *testing.T) {
	server, requests := fakeControlPlane(t)
	h := (&Agent{Version: "test", StateDir: t.TempDir()}).Handler()

	_, status, _ := call(t, h, http.MethodGet, "/v1/status", nil)
	assert.Equal(t, "not_enrolled", status.State)

	rec, status, _ := call(t, h, http.MethodPost, "/v1/up", ipc.UpRequest{Token: "good", Server: server})
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	assert.Equal(t, "enrolled", status.State)
	assert.Equal(t, "10.77.0.9", status.Device.MeshIPv4)
	assert.Equal(t, "home", status.Network.Name)

	// Only public keys leave the machine.
	require.Len(t, *requests, 1)
	sent := (*requests)[0]
	assert.Len(t, sent.IdentityPublicKey, 44)
	assert.Len(t, sent.WireGuardPublicKey, 44)
	assert.NotEmpty(t, sent.Hostname)
	assert.NotEmpty(t, sent.Platform)

	_, status, _ = call(t, h, http.MethodGet, "/v1/status", nil)
	assert.Equal(t, "enrolled", status.State)
	assert.Equal(t, server, status.Server)
}

func TestUpWhenAlreadyEnrolled(t *testing.T) {
	server, _ := fakeControlPlane(t)
	h := (&Agent{Version: "test", StateDir: t.TempDir()}).Handler()

	rec, _, _ := call(t, h, http.MethodPost, "/v1/up", ipc.UpRequest{Token: "good", Server: server})
	require.Equal(t, http.StatusOK, rec.Code)

	rec, _, apiErr := call(t, h, http.MethodPost, "/v1/up", ipc.UpRequest{Token: "good", Server: server})
	assert.Equal(t, http.StatusConflict, rec.Code)
	assert.Equal(t, "already_enrolled", apiErr.Code)
}

func TestUpWithInvalidToken(t *testing.T) {
	server, _ := fakeControlPlane(t)
	stateDir := t.TempDir()
	h := (&Agent{Version: "test", StateDir: stateDir}).Handler()

	rec, _, apiErr := call(t, h, http.MethodPost, "/v1/up", ipc.UpRequest{Token: "bad", Server: server})
	assert.Equal(t, http.StatusBadGateway, rec.Code)
	assert.Equal(t, "invalid_enrollment_token", apiErr.Code)

	// Nothing is saved when enrollment fails.
	_, status, _ := call(t, h, http.MethodGet, "/v1/status", nil)
	assert.Equal(t, "not_enrolled", status.State)
}

func TestUpValidatesRequest(t *testing.T) {
	h := (&Agent{Version: "test", StateDir: t.TempDir()}).Handler()
	// No token on a machine that isn't enrolled: nothing to reconnect.
	rec, _, apiErr := call(t, h, http.MethodPost, "/v1/up", ipc.UpRequest{})
	assert.Equal(t, http.StatusBadRequest, rec.Code)
	assert.Equal(t, "not_enrolled", apiErr.Code)
}

func TestHostnameIsSanitized(t *testing.T) {
	assert.Regexp(t, `^[A-Za-z0-9][A-Za-z0-9.-]*$`, hostname())
}

func TestDeviceName(t *testing.T) {
	assert.Equal(t, "Jabeds-MacBook-Air", deviceName("Jabeds-MacBook-Air.local"))
	assert.Equal(t, "web-1", deviceName("web-1.prod.example.com"))
	assert.Equal(t, "thinkpad", deviceName("thinkpad"))
	assert.Equal(t, "my-laptop", deviceName("my laptop"))
	assert.Equal(t, "device", deviceName(""))
	assert.Equal(t, "device", deviceName(".local"))
}

func TestLocalAPIRefusesOtherUsers(t *testing.T) {
	a := &Agent{Version: "test", StateDir: t.TempDir(), Operators: []uint32{4242}}
	h := a.Handler()
	serve := func(req *http.Request) int {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec.Code
	}
	as := func(uid uint32) *http.Request {
		req := httptest.NewRequest(http.MethodGet, "/v1/status", nil)
		return req.WithContext(ipc.WithCaller(req.Context(), ipc.Caller{UID: uid}))
	}

	assert.Equal(t, http.StatusOK, serve(as(0)), "root")
	assert.Equal(t, http.StatusOK, serve(as(uint32(os.Geteuid()))), "agent's own user")
	assert.Equal(t, http.StatusOK, serve(as(4242)), "operator")
	assert.Equal(t, http.StatusForbidden, serve(as(4343)), "other user")
	assert.Equal(t, http.StatusForbidden, serve(httptest.NewRequest(http.MethodGet, "/v1/status", nil)), "unknown caller")
}
