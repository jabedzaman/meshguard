package dns

import (
	"context"
	"errors"
	"net"
	"net/netip"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/net/dns/dnsmessage"
)

func TestMatchDomain(t *testing.T) {
	domains := []string{"corp.test", "example.org"}
	for name, want := range map[string]bool{
		"corp.test":          true,
		"app.corp.test":      true,
		"a.b.corp.test":      true,
		"example.org":        true,
		"notcorp.test":       false,
		"corp.test.evil.com": false,
		"test":               false,
		"":                   false,
	} {
		assert.Equal(t, want, MatchDomain(name, domains), name)
	}
}

func fakeLookup(answers map[string][]string) Lookup {
	return func(_ context.Context, network, host string) ([]netip.Addr, error) {
		list, ok := answers[host]
		if !ok {
			return nil, &net.DNSError{Err: "no such host", Name: host, IsNotFound: true}
		}
		var out []netip.Addr
		for _, s := range list {
			a := netip.MustParseAddr(s)
			if (network == "ip4") == a.Is4() {
				out = append(out, a)
			}
		}
		return out, nil
	}
}

func answer(t *testing.T, name string, qtype dnsmessage.Type, domains []string, lookup Lookup) (dnsmessage.Message, []netip.Addr) {
	t.Helper()
	res, learned, err := AnswerConnectorQuery(context.Background(), query(t, name, qtype), domains, lookup)
	require.NoError(t, err)
	var m dnsmessage.Message
	require.NoError(t, m.Unpack(res))
	assert.Equal(t, uint16(42), m.ID)
	return m, learned
}

func TestConnectorAnswersOnlyItsDomains(t *testing.T) {
	lookup := fakeLookup(map[string][]string{
		"app.corp.test": {"192.168.50.10", "2001:db8::10"},
		"other.org":     {"1.2.3.4"},
	})
	domains := []string{"corp.test"}

	m, learned := answer(t, "app.corp.test.", dnsmessage.TypeA, domains, lookup)
	assert.Equal(t, dnsmessage.RCodeSuccess, m.RCode)
	require.Len(t, m.Answers, 1)
	assert.Equal(t, [4]byte{192, 168, 50, 10}, m.Answers[0].Body.(*dnsmessage.AResource).A)
	assert.Equal(t, []netip.Addr{netip.MustParseAddr("192.168.50.10")}, learned)

	m, learned = answer(t, "app.corp.test.", dnsmessage.TypeAAAA, domains, lookup)
	require.Len(t, m.Answers, 1)
	assert.Equal(t, []netip.Addr{netip.MustParseAddr("2001:db8::10")}, learned)

	m, learned = answer(t, "other.org.", dnsmessage.TypeA, domains, lookup)
	assert.Equal(t, dnsmessage.RCodeRefused, m.RCode, "never an open resolver")
	assert.Empty(t, learned)

	m, _ = answer(t, "missing.corp.test.", dnsmessage.TypeA, domains, lookup)
	assert.Equal(t, dnsmessage.RCodeNameError, m.RCode)

	m, learned = answer(t, "app.corp.test.", dnsmessage.TypeMX, domains, lookup)
	assert.Equal(t, dnsmessage.RCodeSuccess, m.RCode)
	assert.Empty(t, m.Answers)
	assert.Empty(t, learned)

	failing := func(context.Context, string, string) ([]netip.Addr, error) { return nil, errors.New("timeout") }
	m, _ = answer(t, "app.corp.test.", dnsmessage.TypeA, domains, failing)
	assert.Equal(t, dnsmessage.RCodeServerFailure, m.RCode)
}

func TestResponseAddrs(t *testing.T) {
	lookup := fakeLookup(map[string][]string{"app.corp.test": {"192.168.50.10", "192.168.50.11"}})
	res, _, err := AnswerConnectorQuery(context.Background(), query(t, "app.corp.test.", dnsmessage.TypeA), []string{"corp.test"}, lookup)
	require.NoError(t, err)

	addrs, ttl, ok := ResponseAddrs(res)
	require.True(t, ok)
	assert.Equal(t, []netip.Addr{netip.MustParseAddr("192.168.50.10"), netip.MustParseAddr("192.168.50.11")}, addrs)
	assert.Equal(t, uint32(ConnectorTTL), ttl)

	refused, _, _ := AnswerConnectorQuery(context.Background(), query(t, "x.org.", dnsmessage.TypeA), []string{"corp.test"}, lookup)
	_, _, ok = ResponseAddrs(refused)
	assert.False(t, ok, "a refusal carries no routes")
	_, _, ok = ResponseAddrs([]byte{1, 2, 3})
	assert.False(t, ok)
}

func TestForwardedDomainsAreAnsweredByThePeerOffTheReadPath(t *testing.T) {
	s := testServer()
	s.SetNetworks([]netip.Prefix{netip.MustParsePrefix("10.77.0.0/16")})
	injected := make(chan []byte, 1)
	s.SetForwarder([]string{"corp.test"}, func(q []byte) []byte {
		time.Sleep(50 * time.Millisecond) // a peer takes a while
		res, _, _ := AnswerConnectorQuery(context.Background(), q, []string{"corp.test"},
			fakeLookup(map[string][]string{"app.corp.test": {"192.168.50.10"}}))
		return res
	}, func(packet []byte) { injected <- packet })

	packet := queryPacket(t, "app.corp.test.", dnsmessage.TypeA)
	start := time.Now()
	reply, handled := s.HandlePacket(packet)
	assert.True(t, handled)
	assert.Nil(t, reply, "nothing now: the answer is injected when it arrives")
	assert.Less(t, time.Since(start), 40*time.Millisecond, "the read path isn't held up")

	select {
	case p := <-injected:
		var m dnsmessage.Message
		ihl := int(p[0]&0xf) * 4
		require.NoError(t, m.Unpack(p[ihl+udpHeaderLen:]))
		require.Len(t, m.Answers, 1)
		assert.Equal(t, [4]byte{192, 168, 50, 10}, m.Answers[0].Body.(*dnsmessage.AResource).A)
		assert.Equal(t, s.Addr(), netip.AddrFrom4([4]byte(p[12:16])), "from the resolver address")
	case <-time.After(2 * time.Second):
		t.Fatal("no answer injected")
	}

	// Mesh names are still answered at once.
	reply, handled = s.HandlePacket(queryPacket(t, "laptop.brave-otter.mesh.jabed.dev.", dnsmessage.TypeA))
	assert.True(t, handled)
	assert.NotNil(t, reply)

	// A failed forward is answered with an error, not silence.
	s.SetForwarder([]string{"corp.test"}, func([]byte) []byte { return nil }, func(p []byte) { injected <- p })
	s.HandlePacket(queryPacket(t, "app.corp.test.", dnsmessage.TypeA))
	select {
	case p := <-injected:
		var m dnsmessage.Message
		require.NoError(t, m.Unpack(p[20+udpHeaderLen:]))
		assert.Equal(t, dnsmessage.RCodeServerFailure, m.RCode)
	case <-time.After(2 * time.Second):
		t.Fatal("no answer injected")
	}
}
