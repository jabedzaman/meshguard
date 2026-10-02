package dns

import (
	"errors"
	"fmt"
	"log/slog"
	"net/netip"
	"os"
	"strings"
)

// resolverFile makes macOS send queries for Domain (and only those) to the
// agent; see man 5 resolver.
const resolverFile = "/etc/resolver/" + Domain

const managedMarker = "# Managed by mesh-agent"

// ConfigureOS points the system resolver at server for Domain. It returns a
// short description of how, for status.
func ConfigureOS(_ string, server netip.Addr) (string, error) {
	if b, err := os.ReadFile(resolverFile); err == nil && !strings.HasPrefix(string(b), managedMarker) {
		return "", fmt.Errorf("%s exists and isn't managed by mesh", resolverFile)
	}
	if err := os.MkdirAll("/etc/resolver", 0o755); err != nil {
		return "", err
	}
	content := fmt.Sprintf("%s\nnameserver %s\n", managedMarker, server)
	if err := os.WriteFile(resolverFile, []byte(content), 0o644); err != nil {
		return "", err
	}
	return resolverFile, nil
}

// UnconfigureOS removes what ConfigureOS set up.
func UnconfigureOS(string) {
	b, err := os.ReadFile(resolverFile)
	if err == nil && strings.HasPrefix(string(b), managedMarker) {
		if err := os.Remove(resolverFile); err != nil && !errors.Is(err, os.ErrNotExist) {
			slog.Warn("remove resolver file", "err", err)
		}
	}
}
