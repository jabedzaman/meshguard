package coordination

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func newFakeControlPlane(t *testing.T) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, http.MethodPost, r.Method)
		assert.Equal(t, "/v1/devices/enroll", r.URL.Path)
		assert.Equal(t, "application/json", r.Header.Get("Content-Type"))

		var req EnrollRequest
		require.NoError(t, json.NewDecoder(r.Body).Decode(&req))
		if req.Token == "bad" {
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = w.Write([]byte(`{"error":{"code":"invalid_enrollment_token","message":"Enrollment token is invalid","requestId":"r1"}}`))
			return
		}
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"device":{"id":"d1","name":"laptop","meshIpv4":"10.77.3.4","meshIpv6":"fd00:1:2:0:a:b:c:d"},"network":{"id":"n1","name":"home","ipv4Cidr":"10.77.0.0/16","ipv6Cidr":"fd00:1:2::/48"}}`))
	}))
	t.Cleanup(srv.Close)
	return srv
}

func TestEnroll(t *testing.T) {
	c := NewClient(newFakeControlPlane(t).URL + "/") // trailing slash is trimmed

	res, err := c.Enroll(context.Background(), EnrollRequest{Token: "mesh_enr_ok", Hostname: "laptop"})
	require.NoError(t, err)
	assert.Equal(t, "10.77.3.4", res.Device.MeshIPv4)
	assert.Equal(t, "home", res.Network.Name)
}

func TestEnrollAPIError(t *testing.T) {
	c := NewClient(newFakeControlPlane(t).URL)

	_, err := c.Enroll(context.Background(), EnrollRequest{Token: "bad"})
	var apiErr *Error
	require.ErrorAs(t, err, &apiErr)
	assert.Equal(t, 401, apiErr.Status)
	assert.Equal(t, "invalid_enrollment_token", apiErr.Code)
	assert.Equal(t, "r1", apiErr.RequestID)
	assert.EqualError(t, err, "Enrollment token is invalid")
}

func TestEnrollUnreachable(t *testing.T) {
	_, err := NewClient("http://127.0.0.1:1").Enroll(context.Background(), EnrollRequest{})
	assert.ErrorContains(t, err, "reach control plane")
}
