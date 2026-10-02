package stun

import (
	"context"
	"log/slog"
	"net"
	"net/netip"
)

// Serve answers STUN binding requests on conn until ctx is done, telling each
// client the address its packets arrive from.
func Serve(ctx context.Context, conn net.PacketConn) error {
	go func() {
		<-ctx.Done()
		conn.Close()
	}()
	buf := make([]byte, 1500)
	for {
		n, from, err := conn.ReadFrom(buf)
		if err != nil {
			if ctx.Err() != nil {
				return nil
			}
			return err
		}
		udp, ok := from.(*net.UDPAddr)
		if !ok {
			continue
		}
		addr := netip.AddrPortFrom(udp.AddrPort().Addr().Unmap(), udp.AddrPort().Port())
		if resp, ok := Response(buf[:n], addr); ok {
			if _, err := conn.WriteTo(resp, from); err != nil {
				slog.Debug("stun reply failed", "to", addr, "err", err)
			}
		}
	}
}
