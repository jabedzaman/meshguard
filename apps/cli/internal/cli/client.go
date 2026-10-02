package cli

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"syscall"

	"github.com/twinlabshq/mesh/internal/ipc"
)

// call sends a request to the local agent and decodes the response or its error.
func (o *options) call(method, path string, body, out any) error {
	var reader io.Reader = http.NoBody
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return err
		}
		reader = bytes.NewReader(data)
	}
	req, err := http.NewRequest(method, "http://agent"+path, reader)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	res, err := ipc.NewClient(o.socket).Do(req)
	if err != nil {
		return agentUnreachable(o.socket, err)
	}
	defer res.Body.Close()

	if res.StatusCode >= 300 {
		var e ipc.Error
		if json.NewDecoder(res.Body).Decode(&e) == nil && e.Message != "" {
			return errors.New(e.Message)
		}
		return fmt.Errorf("agent returned %s", res.Status)
	}
	if out == nil {
		return nil
	}
	return json.NewDecoder(res.Body).Decode(out)
}

func agentUnreachable(socket string, err error) error {
	hint := "is mesh-agent running? start it with: sudo mesh-agent install"
	switch {
	case errors.Is(err, syscall.EACCES) || strings.Contains(err.Error(), "permission denied"):
		hint = "permission denied: run with sudo, or reinstall the agent with sudo mesh-agent install so you own the socket"
	case errors.Is(err, os.ErrNotExist) || strings.Contains(err.Error(), "no such file"):
		hint = "no agent socket here: start it with sudo mesh-agent install, or set --socket / MESH_SOCKET"
	}
	return fmt.Errorf("agent not reachable at %s: %s", socket, hint)
}

func (o *options) status() (ipc.Status, error) {
	var s ipc.Status
	err := o.call(http.MethodGet, "/v1/status", nil, &s)
	return s, err
}

func printJSON(v any) error {
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	return enc.Encode(v)
}
