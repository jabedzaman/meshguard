package wireguard

import (
	"log/slog"
	"sync/atomic"

	"golang.zx2c4.com/wireguard/tun"

	"github.com/jabedzaman/meshguard/internal/acl"
)

// LocalHandler sees each packet the OS sends into the TUN. It claims the ones
// for addresses the agent serves itself (handled), which never reach peers,
// and may return a reply packet for the OS.
type LocalHandler func(packet []byte) (reply []byte, handled bool)

// filteredTUN applies the access rules between WireGuard and the OS: packets
// read from the TUN are going out to peers (tracked so replies pass), packets
// written to it came from peers and are dropped unless allowed. Packets the
// local handler claims are answered here instead.
type filteredTUN struct {
	tun.Device
	filter *acl.Filter
	local  atomic.Pointer[LocalHandler]
}

func (t *filteredTUN) Read(bufs [][]byte, sizes []int, offset int) (int, error) {
	n, err := t.Device.Read(bufs, sizes, offset)
	local := t.local.Load()
	var replies [][]byte
	for i := range n {
		if sizes[i] == 0 {
			continue
		}
		packet := bufs[i][offset : offset+sizes[i]]
		if local != nil {
			if reply, handled := (*local)(packet); handled {
				sizes[i] = 0 // WireGuard skips empty packets
				if reply != nil {
					buf := make([]byte, offset+len(reply))
					copy(buf[offset:], reply)
					replies = append(replies, buf)
				}
				continue
			}
		}
		t.filter.Outbound(packet)
	}
	if replies != nil {
		// Straight to the OS: local answers aren't from a peer.
		if _, werr := t.Device.Write(replies, offset); werr != nil {
			slog.Debug("local reply failed", "err", werr)
		}
	}
	return n, err
}

func (t *filteredTUN) Write(bufs [][]byte, offset int) (int, error) {
	var kept [][]byte // allocated only once something is dropped
	for i, b := range bufs {
		if t.filter.Allow(b[offset:]) {
			if kept != nil {
				kept = append(kept, b)
			}
			continue
		}
		if kept == nil {
			kept = make([][]byte, i, len(bufs))
			copy(kept, bufs[:i])
		}
	}
	if kept == nil {
		return t.Device.Write(bufs, offset)
	}
	if len(kept) == 0 {
		return len(bufs), nil
	}
	if _, err := t.Device.Write(kept, offset); err != nil {
		return 0, err
	}
	return len(bufs), nil
}
