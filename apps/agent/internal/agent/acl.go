package agent

import (
	"log/slog"
	"net/netip"

	"github.com/jabedzaman/meshguard/internal/acl"
	"github.com/jabedzaman/meshguard/internal/coordination"
	"github.com/jabedzaman/meshguard/internal/ipc"
)

// aclPolicy turns the control plane's access rules into the filter's policy.
// Rules it can't understand are skipped, which only ever denies more.
func aclPolicy(a *coordination.ACL) acl.Policy {
	if a == nil || a.DefaultAction == "allow" {
		return acl.AllowAllPolicy
	}
	policy := acl.Policy{Rules: []acl.Rule{}}
	for _, r := range a.Inbound {
		rule, ok := aclRule(r)
		if !ok {
			slog.Warn("skipping access rule", "rule", r)
			continue
		}
		policy.Rules = append(policy.Rules, rule)
	}
	return policy
}

func aclRule(r coordination.ACLRule) (acl.Rule, bool) {
	rule := acl.Rule{Protocol: acl.Protocol(r.Protocol)}
	switch rule.Protocol {
	case acl.Any, acl.TCP, acl.UDP, acl.ICMP:
	default:
		return rule, false
	}
	if r.Sources != nil {
		for _, s := range r.Sources {
			ip, err := netip.ParseAddr(s)
			if err != nil {
				return rule, false
			}
			rule.Sources = append(rule.Sources, netip.PrefixFrom(ip, ip.BitLen()))
		}
		// Named devices without addresses: nobody, not everybody.
		if len(rule.Sources) == 0 {
			return rule, false
		}
	}
	if r.PortFrom != nil {
		first, last := *r.PortFrom, *r.PortFrom
		if r.PortTo != nil {
			last = *r.PortTo
		}
		if first < 1 || last < first || last > 65535 {
			return rule, false
		}
		rule.PortFirst, rule.PortLast = uint16(first), uint16(last)
	}
	return rule, true
}

// aclStatus summarizes the rules in effect. Nil before the first sync.
func aclStatus(a *coordination.ACL, synced bool, dropped uint64) *ipc.ACLStatus {
	if !synced {
		return nil
	}
	s := &ipc.ACLStatus{DefaultAction: "allow", Dropped: dropped}
	if a != nil && a.DefaultAction != "allow" {
		s.DefaultAction = "deny"
		s.Rules = len(a.Inbound)
	}
	return s
}
