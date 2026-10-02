package service

import (
	"fmt"
	"os"
	"os/exec"
)

const plistPath = "/Library/LaunchDaemons/" + Label + ".plist"

func install(cfg Config) error {
	if err := os.WriteFile(plistPath, []byte(LaunchdPlist(cfg)), 0o644); err != nil {
		return err
	}
	_ = exec.Command("launchctl", "bootout", "system/"+Label).Run() // replace a running copy
	if out, err := exec.Command("launchctl", "bootstrap", "system", plistPath).CombinedOutput(); err != nil {
		return fmt.Errorf("launchctl bootstrap: %w: %s", err, out)
	}
	return nil
}

func uninstall() error {
	_ = exec.Command("launchctl", "bootout", "system/"+Label).Run()
	if err := os.Remove(plistPath); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

// Describe says where the service lives, for the CLI output.
func Describe() string {
	return "launchd daemon " + Label + " (" + plistPath + "), logs in /var/log/meshguard-agent.log"
}
