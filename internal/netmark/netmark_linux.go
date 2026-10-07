package netmark

import "syscall"

// control sets SO_MARK on the socket before it connects.
func control(_, _ string, c syscall.RawConn) error {
	var sockErr error
	if err := c.Control(func(fd uintptr) {
		sockErr = syscall.SetsockoptInt(int(fd), syscall.SOL_SOCKET, syscall.SO_MARK, Mark)
	}); err != nil {
		return err
	}
	// Without CAP_NET_ADMIN the mark can't be set; the socket still works,
	// just not around an exit node.
	_ = sockErr
	return nil
}
