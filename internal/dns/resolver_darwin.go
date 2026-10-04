package dns

import (
	"errors"
	"fmt"
	"log/slog"
	"net/netip"
	"os"
	"path/filepath"
	"strings"
)

// resolverDir holds one file per domain macOS sends to a specific resolver;
// see man 5 resolver.
const resolverDir = "/etc/resolver"

const managedMarker = "# Managed by meshguard-agent"

// ConfigureOS points the system resolver at resolver for Domain and the
// reverse zones only. It returns a short description of how, for status.
// Short names don't resolve on macOS: it ignores search domains from these
// files for unqualified names.
func ConfigureOS(_ string, resolver netip.Addr, reverseZones []string) (string, error) {
	if err := os.MkdirAll(resolverDir, 0o755); err != nil {
		return "", err
	}
	removeManaged() // reverse zones from an earlier network
	content := fmt.Sprintf("%s\nnameserver %s\n", managedMarker, resolver)
	for _, zone := range append([]string{Domain}, reverseZones...) {
		file := filepath.Join(resolverDir, zone)
		if b, err := os.ReadFile(file); err == nil && !strings.HasPrefix(string(b), managedMarker) {
			return "", fmt.Errorf("%s exists and isn't managed by meshguard", file)
		}
		if err := os.WriteFile(file, []byte(content), 0o644); err != nil {
			return "", err
		}
	}
	return filepath.Join(resolverDir, Domain), nil
}

// UnconfigureOS removes what ConfigureOS set up.
func UnconfigureOS(string) { removeManaged() }

// removeManaged deletes every resolver file meshguard wrote.
func removeManaged() {
	entries, err := os.ReadDir(resolverDir)
	if err != nil {
		return
	}
	for _, e := range entries {
		file := filepath.Join(resolverDir, e.Name())
		b, err := os.ReadFile(file)
		if err != nil || !strings.HasPrefix(string(b), managedMarker) {
			continue
		}
		if err := os.Remove(file); err != nil && !errors.Is(err, os.ErrNotExist) {
			slog.Warn("remove resolver file", "file", file, "err", err)
		}
	}
}
