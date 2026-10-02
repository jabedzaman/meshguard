package wireguard

import (
	"golang.zx2c4.com/wireguard/tun"

	"github.com/jabedzaman/meshguard/internal/acl"
)

// filteredTUN applies the access rules between WireGuard and the OS: packets
// read from the TUN are going out to peers (tracked so replies pass), packets
// written to it came from peers and are dropped unless allowed.
type filteredTUN struct {
	tun.Device
	filter *acl.Filter
}

func (t *filteredTUN) Read(bufs [][]byte, sizes []int, offset int) (int, error) {
	n, err := t.Device.Read(bufs, sizes, offset)
	for i := range n {
		if sizes[i] > 0 {
			t.filter.Outbound(bufs[i][offset : offset+sizes[i]])
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
