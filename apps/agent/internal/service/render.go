package service

import (
	"fmt"
	"strings"
)

// LaunchdPlist renders the launchd daemon definition.
func LaunchdPlist(cfg Config) string {
	var args strings.Builder
	for _, a := range append([]string{cfg.Binary}, cfg.Args...) {
		fmt.Fprintf(&args, "\t\t<string>%s</string>\n", xmlEscape(a))
	}
	return fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>%s</string>
	<key>ProgramArguments</key>
	<array>
%s	</array>
	<key>RunAtLoad</key>
	<true/>
	<key>KeepAlive</key>
	<true/>
	<key>StandardOutPath</key>
	<string>/var/log/mesh-agent.log</string>
	<key>StandardErrorPath</key>
	<string>/var/log/mesh-agent.log</string>
</dict>
</plist>
`, Label, args.String())
}

// SystemdUnit renders the systemd unit.
func SystemdUnit(cfg Config) string {
	parts := []string{shellQuote(cfg.Binary)}
	for _, a := range cfg.Args {
		parts = append(parts, shellQuote(a))
	}
	return fmt.Sprintf(`[Unit]
Description=Mesh agent
Documentation=https://github.com/twinlabshq/mesh
Wants=network-online.target
After=network-online.target

[Service]
ExecStart=%s
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
`, strings.Join(parts, " "))
}
