package service

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
)

const (
	unitName = "meshguard-agent.service"
	unitPath = "/etc/systemd/system/" + unitName
)

func install(cfg Config) error {
	if _, err := os.Stat("/run/systemd/system"); err != nil {
		return errors.New("systemd is not running; start meshguard-agent another way (e.g. sudo meshguard-agent &)")
	}
	if err := os.WriteFile(unitPath, []byte(SystemdUnit(cfg)), 0o644); err != nil {
		return err
	}
	for _, args := range [][]string{{"daemon-reload"}, {"enable", unitName}, {"restart", unitName}} {
		if out, err := exec.Command("systemctl", args...).CombinedOutput(); err != nil {
			return fmt.Errorf("systemctl %v: %w: %s", args, err, out)
		}
	}
	return nil
}

func uninstall() error {
	_ = exec.Command("systemctl", "disable", "--now", unitName).Run()
	if err := os.Remove(unitPath); err != nil && !os.IsNotExist(err) {
		return err
	}
	_ = exec.Command("systemctl", "daemon-reload").Run()
	return nil
}

// Describe says where the service lives, for the CLI output.
func Describe() string {
	return "systemd unit " + unitName + " (" + unitPath + "), logs: journalctl -u meshguard-agent"
}
