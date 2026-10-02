// Package acl filters packets arriving from peers by the network's access
// rules. Each device only enforces what may reach it (the control plane sends
// it the inbound rules that name it); replies to connections it opened are
// let through by tracking its outbound flows.
package acl
