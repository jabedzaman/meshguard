// Package service installs meshguard-agent as a system service: a launchd daemon on
// macOS, a systemd unit on Linux. The service starts at boot and restarts if
// the agent exits.
package service

import (
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

const (
	// Label is the launchd label / systemd unit name.
	Label = "dev.jabed.meshguard.agent"
	// BinDir is where install copies the binaries.
	BinDir = "/usr/local/bin"
)

// Config describes the service to install.
type Config struct {
	// Absolute path to the installed agent binary.
	Binary string
	// Agent flags, e.g. -socket-owner 501:20.
	Args []string
}

// ErrNotRoot is returned when installing or uninstalling without root.
var ErrNotRoot = errors.New("managing the system service needs root: run it with sudo")

// Install copies the agent (and the meshguard CLI if it sits next to it) into
// BinDir and registers and starts the service.
func Install(args []string) error {
	if os.Geteuid() != 0 {
		return ErrNotRoot
	}
	self, err := os.Executable()
	if err != nil {
		return err
	}
	self, _ = filepath.EvalSymlinks(self)

	if err := os.MkdirAll(BinDir, 0o755); err != nil {
		return err
	}
	agent := filepath.Join(BinDir, "meshguard-agent")
	if err := copyBinary(self, agent); err != nil {
		return fmt.Errorf("install %s: %w", agent, err)
	}
	if cli := filepath.Join(filepath.Dir(self), "meshguard"); fileExists(cli) {
		if err := copyBinary(cli, filepath.Join(BinDir, "meshguard")); err != nil {
			return fmt.Errorf("install meshguard CLI: %w", err)
		}
	}
	return install(Config{Binary: agent, Args: args})
}

// Uninstall stops and removes the service. Binaries and state are kept.
func Uninstall() error {
	if os.Geteuid() != 0 {
		return ErrNotRoot
	}
	return uninstall()
}

func copyBinary(src, dst string) error {
	if src == dst {
		return nil
	}
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	// Write next to the destination and rename, so a running copy isn't
	// truncated mid-flight.
	tmp, err := os.CreateTemp(filepath.Dir(dst), ".meshguard-install-*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if _, err := io.Copy(tmp, in); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Chmod(0o755); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), dst)
}

func fileExists(p string) bool {
	info, err := os.Stat(p)
	return err == nil && !info.IsDir()
}

// shellQuote quotes an argument for a systemd ExecStart line.
func shellQuote(s string) string {
	if s != "" && !strings.ContainsAny(s, " \t\"'\\$") {
		return s
	}
	return `"` + strings.NewReplacer(`\`, `\\`, `"`, `\"`, `$`, `$$`).Replace(s) + `"`
}

func xmlEscape(s string) string {
	return strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", `"`, "&quot;", "'", "&apos;").Replace(s)
}
