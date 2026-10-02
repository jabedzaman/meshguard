package ipc

import (
	"net"

	"golang.org/x/sys/unix"
)

func peerCredentials(c *net.UnixConn) (Caller, error) {
	raw, err := c.SyscallConn()
	if err != nil {
		return Caller{}, err
	}
	var cred *unix.Xucred
	var credErr error
	if err := raw.Control(func(fd uintptr) {
		cred, credErr = unix.GetsockoptXucred(int(fd), unix.SOL_LOCAL, unix.LOCAL_PEERCRED)
	}); err != nil {
		return Caller{}, err
	}
	if credErr != nil {
		return Caller{}, credErr
	}
	var gid uint32
	if cred.Ngroups > 0 {
		gid = cred.Groups[0]
	}
	return Caller{UID: cred.Uid, GID: gid}, nil
}
