//go:build !linux && !darwin

package wireguard

import (
	"fmt"
	"net/netip"
	"runtime"
)

func configureInterface(string, []netip.Prefix, []netip.Prefix) error {
	return fmt.Errorf("interface configuration is not supported on %s yet", runtime.GOOS)
}
