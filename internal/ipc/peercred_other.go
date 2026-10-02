//go:build !linux && !darwin

package ipc

import (
	"errors"
	"net"
)

func peerCredentials(*net.UnixConn) (Caller, error) {
	return Caller{}, errors.New("peer credentials are not supported on this platform")
}
