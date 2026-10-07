package cli

import (
	"fmt"
	"net/http"
	"os"
	"slices"
	"strconv"
	"text/tabwriter"

	"github.com/spf13/cobra"

	"github.com/jabedzaman/meshguard/internal/ipc"
)

func newServe(o *options) *cobra.Command {
	var port int
	cmd := &cobra.Command{
		Use:   "serve [port]",
		Short: "Share a local service with your peers on this device's mesh address",
		Long: `Share a service that only listens on this machine (127.0.0.1) with your peers.
The agent listens on this device's mesh address and passes each connection to
the local port, so peers connect to <this device>:<port> without the service
having to bind to anything but localhost. Access rules still apply.

  meshguard serve 3000              peers reach this device on port 3000
  meshguard serve 3000 --port 8080  peers use port 8080 instead
  meshguard serve                   list what is shared
  meshguard serve off 8080          stop sharing port 8080`,
		Args: cobra.MaximumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			if len(args) == 0 {
				return o.listServe()
			}
			target, err := strconv.Atoi(args[0])
			if err != nil || target < 1 || target > 65535 {
				return fmt.Errorf("%q isn't a port (1-65535)", args[0])
			}
			if port == 0 {
				port = target
			}
			return o.updateServe(func(rules []ipc.ServeRule) []ipc.ServeRule {
				rules = slices.DeleteFunc(rules, func(r ipc.ServeRule) bool { return r.Port == port })
				return append(rules, ipc.ServeRule{Port: port, Target: strconv.Itoa(target)})
			})
		},
	}
	cmd.Flags().IntVar(&port, "port", 0, "port peers connect to (default: the same as the local one)")
	cmd.Flags().BoolVar(&o.json, "json", false, "print JSON")
	cmd.AddCommand(&cobra.Command{
		Use:   "off <port>",
		Short: "Stop sharing a port",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			shared, err := strconv.Atoi(args[0])
			if err != nil {
				return fmt.Errorf("%q isn't a port", args[0])
			}
			return o.updateServe(func(rules []ipc.ServeRule) []ipc.ServeRule {
				return slices.DeleteFunc(rules, func(r ipc.ServeRule) bool { return r.Port == shared })
			})
		},
	})
	return cmd
}

// updateServe changes the shared services with edit and prints the result.
func (o *options) updateServe(edit func([]ipc.ServeRule) []ipc.ServeRule) error {
	var prefs ipc.Prefs
	if err := o.call(http.MethodGet, "/v1/prefs", nil, &prefs); err != nil {
		return err
	}
	rules := edit(slices.Clone(prefs.Serve))
	if err := o.call(http.MethodPatch, "/v1/prefs", ipc.PrefsUpdate{Serve: &rules}, &prefs); err != nil {
		return err
	}
	return o.listServe()
}

func (o *options) listServe() error {
	s, err := o.status()
	if err != nil {
		return err
	}
	if o.json {
		if s.Serve == nil {
			s.Serve = []ipc.ServeRule{}
		}
		return printJSON(s.Serve)
	}
	if len(s.Serve) == 0 {
		fmt.Println("Nothing is shared. Share a local port with: meshguard serve <port>")
		return nil
	}
	ip := ""
	if s.Device != nil {
		ip = s.Device.MeshIPv4
	}
	w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
	fmt.Fprintln(w, "PEERS CONNECT TO\tLOCAL SERVICE\tSTATUS")
	for _, r := range s.Serve {
		status := "listening"
		if r.Error != "" {
			status = r.Error
		}
		fmt.Fprintf(w, "%s:%d\t%s\t%s\n", ip, r.Port, r.Target, status)
	}
	return w.Flush()
}
