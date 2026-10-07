//go:build !linux

package netmark

import "syscall"

func control(string, string, syscall.RawConn) error { return nil }
