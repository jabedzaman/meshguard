package service

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

var cfg = Config{
	Binary: "/usr/local/bin/meshguard-agent",
	Args:   []string{"-socket-owner", "501:20", "-state-dir", "/Library/Application Support/MeshGuard"},
}

func TestLaunchdPlist(t *testing.T) {
	plist := LaunchdPlist(cfg)
	assert.Contains(t, plist, "<string>dev.jabed.meshguard.agent</string>")
	assert.Contains(t, plist, "\t\t<string>/usr/local/bin/meshguard-agent</string>\n\t\t<string>-socket-owner</string>\n\t\t<string>501:20</string>")
	assert.Contains(t, plist, "<string>/Library/Application Support/MeshGuard</string>", "spaces need no quoting in plist")
	assert.Contains(t, plist, "<key>KeepAlive</key>\n\t<true/>")
	assert.Contains(t, plist, "<key>RunAtLoad</key>\n\t<true/>")
}

func TestLaunchdPlistEscapesXML(t *testing.T) {
	assert.Contains(t, LaunchdPlist(Config{Binary: "/bin/a&b"}), "<string>/bin/a&amp;b</string>")
}

func TestSystemdUnit(t *testing.T) {
	unit := SystemdUnit(cfg)
	assert.Contains(t, unit, `ExecStart=/usr/local/bin/meshguard-agent -socket-owner 501:20 -state-dir "/Library/Application Support/MeshGuard"`)
	assert.Contains(t, unit, "Restart=always")
	assert.Contains(t, unit, "WantedBy=multi-user.target")
	assert.Contains(t, unit, "After=network-online.target")
}

func TestShellQuote(t *testing.T) {
	assert.Equal(t, "plain", shellQuote("plain"))
	assert.Equal(t, `""`, shellQuote(""))
	assert.Equal(t, `"a b"`, shellQuote("a b"))
	assert.Equal(t, `"cost$$1"`, shellQuote("cost$1"), "systemd expands $; escape it")
	assert.Equal(t, `"say \"hi\""`, shellQuote(`say "hi"`))
}
