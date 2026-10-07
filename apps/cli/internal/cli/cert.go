package cli

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/spf13/cobra"

	"github.com/jabedzaman/meshguard/internal/ipc"
)

func newCert(o *options) *cobra.Command {
	var out string
	var force bool
	cmd := &cobra.Command{
		Use:   "cert",
		Short: "Get an HTTPS certificate for this device's mesh name",
		Long: `Get a TLS certificate for this device's mesh name (e.g.
laptop.brave-otter.mesh.jabed.dev) from the certificate authority the control
plane uses, and write <name>.crt and <name>.key to --out (default: here).

The private key is made on this device and never leaves it. The agent keeps the
certificate and returns the saved one until a third of its life is left (30 days of
90), so it is safe
to run often. Use it with any server, e.g.
  meshguard cert && caddy file-server --listen :443 --tls-cert laptop.*.crt ...
Peers connect to https://<name> and see a trusted certificate.

The control plane must have certificates turned on (ACME_DIRECTORY_URL).`,
		Args: cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			var cert ipc.Cert
			if err := o.call(http.MethodPost, "/v1/cert", ipc.CertRequest{Force: force}, &cert); err != nil {
				return err
			}
			if err := os.MkdirAll(out, 0o755); err != nil {
				return err
			}
			certFile := filepath.Join(out, cert.Name+".crt")
			keyFile := filepath.Join(out, cert.Name+".key")
			if err := os.WriteFile(certFile, []byte(cert.Certificate), 0o644); err != nil {
				return err
			}
			if err := os.WriteFile(keyFile, []byte(cert.Key), 0o600); err != nil {
				return err
			}
			if o.json {
				return printJSON(map[string]any{
					"name": cert.Name, "certificate": certFile, "key": keyFile,
					"notAfter": cert.NotAfter, "renewed": cert.Renewed,
				})
			}
			verb := "Saved certificate"
			if cert.Renewed {
				verb = "Issued certificate"
			}
			fmt.Printf("%s for %s (valid until %s)\n  %s\n  %s\n",
				verb, cert.Name, cert.NotAfter.Local().Format(time.DateOnly), certFile, keyFile)
			return nil
		},
	}
	cmd.Flags().StringVar(&out, "out", ".", "directory to write <name>.crt and <name>.key to")
	cmd.Flags().BoolVar(&force, "force", false, "get a new certificate even if the saved one is still good")
	cmd.Flags().BoolVar(&o.json, "json", false, "print JSON")
	return cmd
}
