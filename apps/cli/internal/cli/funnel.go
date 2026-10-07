package cli

import (
	"fmt"
	"net/http"
	"strconv"

	"github.com/spf13/cobra"

	"github.com/jabedzaman/meshguard/internal/ipc"
)

func newFunnel(o *options) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "funnel [port]",
		Short: "Share a local port with the internet through the relay",
		Long: `Share a service on this machine with anyone on the internet, at
https://<this device's mesh name>, through the relay. Visitors' TLS goes through the
relay untouched and ends on this device, with its own certificate (see
meshguard cert); the service on the port can speak plain HTTP.

An owner or admin must first turn on public access for this device in the web.
Until then nothing is exposed, whatever port you choose here.

  meshguard funnel 3000     share local port 3000
  meshguard funnel          show whether it is live
  meshguard funnel off      stop sharing`,
		Args: cobra.MaximumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			if len(args) == 0 {
				return o.showFunnel()
			}
			port, err := strconv.Atoi(args[0])
			if err != nil || port < 1 || port > 65535 {
				return fmt.Errorf("%q isn't a port (1-65535)", args[0])
			}
			return o.setFunnel(port)
		},
	}
	cmd.Flags().BoolVar(&o.json, "json", false, "print JSON")
	cmd.AddCommand(&cobra.Command{
		Use:   "off",
		Short: "Stop sharing",
		Args:  cobra.NoArgs,
		RunE:  func(*cobra.Command, []string) error { return o.setFunnel(0) },
	})
	return cmd
}

func (o *options) setFunnel(port int) error {
	var prefs ipc.Prefs
	if err := o.call(http.MethodPatch, "/v1/prefs", ipc.PrefsUpdate{FunnelPort: &port}, &prefs); err != nil {
		return err
	}
	return o.showFunnel()
}

func (o *options) showFunnel() error {
	s, err := o.status()
	if err != nil {
		return err
	}
	if o.json {
		return printJSON(s.Funnel)
	}
	f := s.Funnel
	switch {
	case f == nil:
		fmt.Println("Nothing is shared with the internet. Share a local port with: meshguard funnel <port>")
	case f.State == "live":
		fmt.Printf("Live: https://%s -> localhost:%d\n", f.Name, f.Port)
	default:
		fmt.Printf("https://%s -> localhost:%d: %s\n", f.Name, f.Port, f.State)
		if f.Problem != "" {
			fmt.Printf("  ! %s\n", f.Problem)
		}
	}
	return nil
}
