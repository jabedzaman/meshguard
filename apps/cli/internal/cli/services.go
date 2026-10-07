package cli

import (
	"fmt"
	"os"
	"text/tabwriter"

	"github.com/spf13/cobra"

	"github.com/jabedzaman/meshguard/internal/ipc"
)

func newServices(o *options) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "services",
		Short: "List the network's services, their addresses and who serves them",
		Long: `List the services in this network. A service is a name and an address that
reaches one online device serving it; owners and admins manage them in the web.
Connect with its name, e.g. curl http://web.svc.<network domain>:8080.`,
		Args: cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			s, err := o.status()
			if err != nil {
				return err
			}
			if o.json {
				if s.Services == nil {
					s.Services = []ipc.Service{}
				}
				return printJSON(s.Services)
			}
			if len(s.Services) == 0 {
				fmt.Println("No services in this network.")
				return nil
			}
			printServices(s.Services)
			return nil
		},
	}
	cmd.Flags().BoolVar(&o.json, "json", false, "print JSON")
	return cmd
}

func printServices(services []ipc.Service) {
	w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
	fmt.Fprintln(w, "NAME\tDNS\tADDRESS\tSERVED BY")
	for _, s := range services {
		host := s.Host
		switch {
		case s.Hosting:
			host = "this device"
		case host == "":
			host = "no host online"
		}
		fmt.Fprintf(w, "%s\t%s\t%s\t%s\n", s.Name, s.DNSName, s.VIP, host)
	}
	w.Flush()
}
