// Command mesh is the command-line interface to the local agent.
package main

import (
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"net/http"
	"os"
	"time"

	"github.com/twinlabshq/mesh/internal/ipc"
)

const usage = `usage: mesh <command> [flags]

commands:
  up --token TOKEN [--server URL]   join a network with an enrollment token
  status                            show this machine's mesh status

The server defaults to $MESH_SERVER, then http://localhost:4000.`

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, usage)
		os.Exit(2)
	}

	var err error
	switch os.Args[1] {
	case "up":
		err = up(os.Args[2:])
	case "status":
		err = status()
	case "help", "-h", "--help":
		fmt.Println(usage)
	default:
		fmt.Fprintf(os.Stderr, "unknown command %q\n\n%s\n", os.Args[1], usage)
		os.Exit(2)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "mesh:", err)
		os.Exit(1)
	}
}

func defaultServer() string {
	if s := os.Getenv("MESH_SERVER"); s != "" {
		return s
	}
	return "http://localhost:4000"
}

func up(args []string) error {
	fs := flag.NewFlagSet("up", flag.ExitOnError)
	token := fs.String("token", "", "enrollment token from the network's Add device dialog")
	server := fs.String("server", defaultServer(), "control plane URL")
	fs.Parse(args)
	if *token == "" {
		return fmt.Errorf("--token is required (create one with Add device on the network page)")
	}

	var s ipc.Status
	if err := call(http.MethodPost, "/v1/up", ipc.UpRequest{Token: *token, Server: *server}, &s); err != nil {
		return err
	}
	fmt.Printf("Joined %s as %s\n", s.Network.Name, s.Device.Name)
	fmt.Printf("  mesh IPv4  %s\n  mesh IPv6  %s\n", s.Device.MeshIPv4, s.Device.MeshIPv6)
	return nil
}

func status() error {
	var s ipc.Status
	if err := call(http.MethodGet, "/v1/status", nil, &s); err != nil {
		return err
	}
	if s.State == "not_enrolled" {
		fmt.Println("Not in a network. Run: mesh up --token <token>")
		return nil
	}
	fmt.Printf("%s in %s (%s)\n", s.Device.Name, s.Network.Name, s.State)
	fmt.Printf("  mesh IPv4  %s\n  mesh IPv6  %s\n  server     %s\n", s.Device.MeshIPv4, s.Device.MeshIPv6, s.Server)
	if s.Interface != "" {
		fmt.Printf("  interface  %s\n", s.Interface)
	}
	if s.Problem != "" {
		fmt.Printf("\n  ! %s\n", s.Problem)
	}
	if len(s.Peers) > 0 {
		fmt.Println("\npeers:")
		for _, p := range s.Peers {
			handshake := "no handshake yet"
			if p.LastHandshake != nil {
				handshake = "handshake " + time.Since(*p.LastHandshake).Round(time.Second).String() + " ago"
			}
			endpoint := p.Endpoint
			if endpoint == "" {
				endpoint = "-"
			}
			fmt.Printf("  %-20s %-15s %-22s %s\n", p.Name, p.MeshIPv4, endpoint, handshake)
		}
	}
	return nil
}

// call sends a request to the local agent and decodes the response or its error.
func call(method, path string, body, out any) error {
	var reader *bytes.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return err
		}
		reader = bytes.NewReader(data)
	} else {
		reader = bytes.NewReader(nil)
	}
	req, err := http.NewRequest(method, "http://agent"+path, reader)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	socket := ipc.DefaultSocketPath()
	res, err := ipc.NewClient(socket).Do(req)
	if err != nil {
		return fmt.Errorf("agent not reachable at %s (is mesh-agent running?): %w", socket, err)
	}
	defer res.Body.Close()

	if res.StatusCode >= 300 {
		var e ipc.Error
		if json.NewDecoder(res.Body).Decode(&e) == nil && e.Message != "" {
			return fmt.Errorf("%s", e.Message)
		}
		return fmt.Errorf("agent returned %s", res.Status)
	}
	return json.NewDecoder(res.Body).Decode(out)
}
