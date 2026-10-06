# Progress

Status of goals and milestones. Update this file in the same commit as the work it describes.

Legend: ✅ done · 🚧 in progress · ⬜ not started

Items are numbered `M<milestone>.<n>` (`L.<n>` for Later) so they can be picked by ID, e.g. "do M1.20". IDs are stable: append new items at the end of a milestone, never renumber.

## North star

> Install → Sign in → Devices appear → Click workspace → Everything connects.

Networking should disappear into the workflow.

## Milestones

### M0 — Repo bootstrap ✅

- ✅ M0.1 pnpm + Turborepo monorepo, `~/*` import alias
- ✅ M0.2 Apps: `api` (Hono), `web` (Next.js), `desktop` (Tauri 2), `mcp`, `agent`, `cli`, `relay` (Go); the `dns` stub was removed (M2.21)
- ✅ M0.3 Packages: `config`, `db`, `auth`, `api-client`, `mcp-sdk`, `ui` (shadcn), `proto`
- ✅ M0.4 TS packages built with tsup, apps run with `tsx watch`
- ✅ M0.5 Go workspace (`go.work`) with shared `internal/` module
- ✅ M0.6 Protobuf contracts linted and generated with buf
- ✅ M0.7 Docker dev env: Postgres, Redis, NATS + api/web/relay/dns with hot reload (`apps/<app>/Dockerfile.dev`, env injected by Compose)
- ✅ M0.8 Typed API client via Hono RPC (`hc<AppType>`), sample `/v1/networks` route
- ✅ M0.9 First Drizzle migration (organizations, networks, devices)
- ✅ M0.10 Playwright e2e suite (`pnpm e2e:up && pnpm test:e2e`) on an isolated stack and `meshguard_test` database
- ✅ M0.11 `apps/www`: website and docs (Next.js + MDX). Pages are `src/content/docs/**/*.mdx`; each folder's `meta.json` sets its sidebar title and order

### M1 — Working private mesh (the real MVP) 🚧

Devices ping each other over WireGuard: directly on a shared network, through the relay otherwise (`pnpm lab`). First real-hardware run: MacBook Air (macOS, utun) ↔ ThinkPad (WSL) in network `home`. Remaining for production use: a public relay/API deployment, then direct connections across NATs.

Goal: Mac A and Mac B on different networks can ping each other's mesh IP, directly over WireGuard, and recover from disconnects automatically.

- ✅ M1.1 Human auth: Better Auth email/password sign-up/sign-in in `api` and `web`
- 🚧 M1.2 GitHub sign-in: wired, needs an OAuth app (`GITHUB_CLIENT_ID/SECRET`)
- ✅ M1.3 Organizations: Better Auth organization plugin, onboarding in `web`, active org restored on sign-in
- ✅ M1.4 `/v1` routes require a session and are scoped to the active organization
- ✅ M1.5 `web` route protection via Next.js proxy with `redirectTo`
- ✅ M1.6 All auth routing in `web/proxy.ts` (session, active org); layouts only load data; onboarding at `/organizations/create`; `/api/organizations/[organizationId]/activate` restores a missing active org
- ✅ M1.7 Networks: create (`POST /v1/networks`), default `10.77.0.0/16` (configurable, RFC 1918 only), random IPv6 ULA /48 per network
- ✅ M1.8 Organization switcher
- ✅ M1.9 Roles: owner / admin / member (`@meshguard/auth/permissions`), enforced in the API with `requirePermission`
- ✅ M1.10 Invitations: invite by email (owner/admin), pending list, cancel; email via workers + react-email
- ✅ M1.11 Invitation page `/invitations/[invitationId]`: accept / decline, sign-up from the link, wrong-account, expired / cancelled / used states
- ✅ M1.12 Role assignment on the members list (owners: any role; admins: admin/member, not owners; own row read-only)
- ✅ M1.13 Remove member (owners/admins; only owners act on owners) and leave organization (proxy then activates the next org)
- ⬜ M1.14 Member search (when orgs grow); stale active org on a leaver's other devices (layout fallback)
- ✅ M1.15 Device identity: Ed25519 identity + Curve25519 WireGuard keys, state file 0600 in a 0700 dir
- ✅ M1.16 Enrollment tokens: create (shown once, hashed), list active, revoke; network page with Add device
- ✅ M1.17 Enrollment: `meshguard up --token` → agent generates keys → `POST /v1/devices/enroll` → device with random free mesh IPv4/IPv6; devices listed on the network page
- ✅ M1.18 Coordination: signed `POST /v1/devices/self/sync` every 10s returns the network map; agent applies peers
- ✅ M1.19 WireGuard: embedded wireguard-go on TUN (`meshguard0` / utun), mesh addresses + network routes (Linux in the lab; macOS on a real MacBook Air ↔ WSL, 2026-10-02, 0% loss both ways)
- ✅ M1.20 Endpoint discovery: local interface addresses + STUN-observed public address
- ✅ M1.21 Presence: sync updates lastSeenAt; the API decides online (30s window); web polls every 5s
- ✅ M1.22 Presence in Redis with TTL keys instead of a Postgres write per sync; Postgres gets endpoint changes and lastSeenAt every 5 min
- ✅ M1.23 Push device events to the web instead of polling: NATS `network.<id>.device.<type>` (enrolled, connected, updated, disconnected via Redis key expiry, removed) → SSE → the device list refetches
- ✅ M1.24 Reconnect: agent restart reconnects from saved state; network changes and wake from sleep rebind sockets, reset NAT/disco state, redial the relay and resync (lab: peer changes address → direct again in ~13s; verified on the MacBook, 2026-10-02)
- ✅ M1.25 CLI (cobra): `meshguard up/down/logout/status/peers/ip/ping/netcheck/version`, JSON output, shell completion ([cli.md](cli.md))
- ✅ M1.26 Agent local API auth: peer credentials on the Unix socket (`SO_PEERCRED` / `LOCAL_PEERCRED`); only root, the agent's user and the socket owner are answered, unknown callers refused
- ⬜ M1.27 Devices owned by a user (`devices.user_id`, null for tagged devices): "my devices" in the web; removing a member removes (or reassigns) their devices
- ⬜ M1.28 Browser login: `meshguard up` without a token prints a URL, the user approves the device in the web, and it enrolls as theirs (the north star's "Sign in"); tokens stay for headless machines
- ⬜ M1.29 Auth keys beyond single-use tokens: reusable, ephemeral (device deleted after being offline a while), pre-approved and tagged; for servers, CI and containers
- ⬜ M1.30 Device approval (optional per network) and key expiry (e.g. 180 days, renewed by browser login, can be turned off per device), so a copied `state.json` stops working
- ⬜ M1.31 Rate limits on `POST /v1/devices/enroll`, device sync and auth routes (Redis)
- ✅ M1.32 Replay protection for signed device requests: a nonce in the signature, seen nonces kept in Redis for twice the clock window (`DeviceNonces`). Requests without a nonce (older agents) are still accepted; refuse them once every agent is updated
- ⬜ M1.33 Change a network's IPv4 range after creation (renumbers devices); `10.77.0.0/16` clashes with corporate `10.0.0.0/8` more often than a CGNAT range would

### M2 — Reachability and naming 🚧

- ✅ M2.1 Relay fallback: WebSocket relay with key-possession handshake; agents relay peers not on a shared network (lab: isolated networks; real hardware: MacBook ↔ WSL via relay, 2026-10-02)
- ✅ M2.2 NAT traversal, first cut: STUN (self-hosted in meshguard-relay), sealed disco pings, learned NAT mappings; direct through a NAT to a reachable peer (lab), relay for symmetric NAT
- ⬜ M2.3 NAT traversal when both peers are behind Linux-style NATs (conntrack port clash): coordinated punching / low-TTL trick / UPnP-NAT-PMP-PCP
- ✅ M2.4 Point-to-point (VPN) interfaces are never advertised or treated as shared networks
- ✅ M2.5 Device names use the short hostname (no `.local`)
- ✅ M2.6 Rename devices from the web: owners/admins, DNS-label names unique per network; agents pick up the name on their next sync (peers' DNS, own status and state)
- ✅ M2.7 Private DNS: `<device>.internal`, answered by the agent on its mesh IP; split DNS via `/etc/resolver` (macOS) and systemd-resolved (Linux); device names are DNS labels unique per network (lab: all pairs resolve each other; MacBook resolves and pings `thinkpad.internal`, 2026-10-02)
- ✅ M2.8 Access rules: per-network default (allow / deny) plus rules (device or any → device or every, protocol, port range), managed by owners/admins on the network page; each agent filters traffic from peers on its TUN with flow tracking for replies (lab: deny, port and ICMP rules on real agents)
- ⬜ M2.9 Key rotation
- ✅ M2.10 Remove devices from the web (owners/admins): peers drop it on their next sync; the removed agent is refused and says how to re-join
- ⬜ M2.11 Access rules by tag or group (`tag:server`), and pushing rule changes to agents instead of waiting for the next sync
- ✅ M2.12 DNS resolver on a reserved mesh address: the agent answers UDP queries to the network's address + 53 (`10.77.0.53`) inside its TUN, which the API never gives a device; no socket, so the macOS `127.0.0.1:53053` workaround is gone; short names (`ssh laptop`) through the `internal` search domain on Linux; reverse lookups (PTR) for mesh addresses (lab: names and reverse lookups for every pair; systemd-resolved settings checked in a container. Not yet on the MacBook)
- ⬜ M2.13 Full DNS: forward other names to the OS's own resolvers, admin split DNS (domain → nameserver over the mesh), override local DNS, NetworkManager / resolvconf fallbacks, Windows NRPT. Waits for exit nodes or a customer that needs it
- ⬜ M2.14 Network map pruned by access rules: a device gets only the peers it may reach or that may reach it (today every device gets every peer's key, addresses and endpoints, even under deny)
- ⬜ M2.15 Streaming network map: a long-lived request (long-poll or WebSocket) with deltas instead of a full map every 10s; rule, name and peer changes arrive at once. Covers the "push" half of M2.11; keep a slow poll as a fallback
- ⬜ M2.16 Relay auth: the relay only serves keys the control plane vouches for (a short-lived signed relay token in the network map); today any key that proves possession can use it
- ⬜ M2.17 Relay regions: several relays, each agent picks the lowest-latency home relay, the network map carries each peer's home relay, relays forward between regions
- ⬜ M2.18 DNS over TCP, and SRV / TXT / CNAME records (service discovery, M6.4)
- ⬜ M2.19 IPv6 resolver address (the network's IPv6 prefix + `::53`) for IPv6-only clients
- ⬜ M2.20 Short names on macOS (`ssh laptop`): `/etc/resolver` ignores search domains, so this needs the system DNS config (`scutil`) or a Network Extension
- ✅ M2.21 Removed the `apps/dns` stub: each agent answers DNS itself; a central forwarder, if M2.13 ever needs one, starts fresh
- ⬜ M2.22 Access rules by user (M1.27), CIDR destinations (subnet routes, M6.1) and services (M6.4); the whole policy viewable as a file in the web, with tests ("a may reach b:22")
- ⬜ M2.23 Lazy peers: configure a peer in WireGuard only when traffic goes to it (or it handshakes), so big networks don't hold hundreds of idle peers
- ✅ M2.24 Keep the device name in memory instead of reading `state.json` on every sync (`saveNameLocked`)
- ⬜ M2.25 One device in several networks: profiles and `meshguard switch`
- ⬜ M2.26 Signed node keys (like Tailnet Lock): agents only accept peer keys signed by trusted admin keys, so a compromised control plane can't add peers

### M3 — Desktop app ⬜

- ✅ M3.1 Agent runs as a system service: `sudo meshguard-agent install` (launchd / systemd; systemd tested by `pnpm test:systemd`; verified on a MacBook and WSL, 2026-10-02)
- ⬜ M3.2 Sign in, device enrollment, network selection
- ⬜ M3.3 Device list, peer health, connection status
- ⬜ M3.4 Agent ↔ desktop over Unix socket
- ⬜ M3.5 Menu-bar mode (carry over from Mapper)

### M4 — Workspaces ⬜

- ⬜ M4.1 Workspace config schema (`workspace.yaml`)
- ⬜ M4.2 Activate / deactivate: remote checks, Docker Compose up, port forwarding
- ⬜ M4.3 Port conflict detection and resolution
- ⬜ M4.4 Service discovery, open URLs
- ⬜ M4.5 Git status / diff
- ⬜ M4.6 `meshguard workspace list|activate|stop`

### M5 — AI and diagnostics 🚧

- ✅ M5.1 `meshguard doctor [peer] [--port N]`: agent, enrollment, WireGuard, control plane sync, route overlap, relay, NAT, DNS through the OS resolver (incl. WSL resolv.conf bypassing systemd-resolved), access rules (`GET /v1/access`: which peers may connect on a port), peer handshakes; for a peer, route, DNS, ping and TCP port; for a local port, listeners peers can reach (Docker `127.0.0.1` publish hint). Exits 1 on failures, `--json` (lab: doctor on a peer's port and rules). Docker container checks wait for workspaces (M4)
- ⬜ M5.2 MCP read-only tools (devices, topology, workspace, git, logs)
- ⬜ M5.3 MCP mutating tools behind explicit approval
- ⬜ M5.4 AI network doctor built on `meshguard doctor`

### M6 — Routes, services and apps ⬜

What Tailscale calls subnet routers, exit nodes, Services, serve/funnel and app connectors. Each builds on the one before; M4 workspaces build on M6.4 and M6.5.

- ⬜ M6.1 Subnet routers: `device_routes` (device, prefix, advertised, approved); `meshguard set --advertise-routes 192.168.1.0/24`; owners/admins approve on the device page; the router agent forwards and masquerades (SNAT in its TUN filter, so it doesn't depend on the host firewall)
- ⬜ M6.2 Accepting routes: approved prefixes go into that peer's allowed IPs and the OS routes on clients that opt in (`--accept-routes`); overlapping routes are picked by priority and shown in the web
- ⬜ M6.3 Exit nodes: a route for `0.0.0.0/0` and `::/0`; `meshguard set --exit-node <device>`; the agent's own traffic (control plane, relay, STUN, peer endpoints) stays off the tunnel (Linux policy routing with an fwmark, macOS `IP_BOUND_IF`). Needs DNS forwarding (M2.13)
- ⬜ M6.4 Services: a name and a virtual IP from the network range (reserved like the DNS resolver) served by one or more devices; `<service>.svc.internal` resolves to it; clients send it to one online host (failover by presence); the host agent rewrites the destination in its TUN filter; access rules can name a service. `meshguard service advertise <name> --port N`, Services page in the web
- ⬜ M6.5 `meshguard serve <port>`: the agent proxies its mesh address to a local port (fixes the `127.0.0.1` publish case `doctor` already detects)
- ⬜ M6.6 HTTPS for mesh names: a public zone (`<device>.<network>.<domain>`) with certificates from ACME DNS-01, answered by the control plane for the agent's CSR; `meshguard cert`
- ⬜ M6.7 Funnel: a public hostname that reaches a device's port through the relay (TLS passthrough, stream frames on the agent's relay WebSocket); off unless an admin enables it
- ⬜ M6.8 App connectors: domains routed through a chosen device; client DNS forwards those domains to it, and it advertises the addresses they resolve to as routes. Needs M6.1, M2.13 and M2.15
- ⬜ M6.9 `meshguard set` for device preferences (advertised routes, accept routes, exit node, accept DNS), saved by the agent and sent on sync

### M7 — Platform and operations ⬜

- ⬜ M7.1 Userspace networking: no TUN or root, a SOCKS5/HTTP proxy into the mesh (containers, CI, rootless machines)
- ⬜ M7.2 Agent auto-update: signed releases, update channel, `meshguard update`
- ⬜ M7.3 Admin API tokens (organization-scoped, with a role) so the API works from scripts and CI; Terraform provider later
- ⬜ M7.4 Audit log: who changed access rules, devices, members, tokens and routes, with a page in the web
- ⬜ M7.5 Webhooks for device and member events
- ⬜ M7.6 Device page in the web: endpoints, path, agent version, OS, key age, routes, last seen
- ⬜ M7.7 Agent metrics (Prometheus on the local API) and optional flow logs
- ⬜ M7.8 Kubernetes: operator or sidecar (needs M7.1 and M1.29)
- ⬜ M7.9 `meshguard whois <ip>`: which device and user a mesh address belongs to
- ⬜ M7.10 File transfer between devices (`meshguard file cp`)
- ⬜ M7.11 SSH by access policy (`meshguard ssh`, keys handed out by the control plane)

### Later ⬜

- ⬜ L.1 Temporary access links (time-limited, audited)
- ⬜ L.2 Windows and Linux agents
- ⬜ L.3 Product name + domain
- ⬜ L.4 iOS and Android apps

## Pathway

Order to work through the open items (from the 2026-10-06 comparison with Tailscale). Each phase leaves the mesh working; later phases depend on earlier ones.

1. **Harden** (small, now): M2.24, M1.31, M1.32, M2.16, M2.21
2. **Identity**: M1.27 → M1.28 → M1.29 → M1.30 → M7.3 → M7.4. Every later feature (user rules, approvals, tagged servers) needs devices to belong to someone
3. **Control plane at scale**: M2.15 → M2.14 → M2.11 + M2.22 → M2.23
4. **Reachability**: M2.3, M2.17, M7.1
5. **DNS**: M2.13 (with M2.21) → M2.18 → M2.19 → M2.20
6. **Routes and services**: M6.9 → M6.1 → M6.2 → M6.3 → M6.4 → M6.5 → M6.6 → M6.7 → M6.8; M4 workspaces after M6.5
7. **Platform**: M7.2, M7.6, M2.9, M2.25, M2.26, M7.5, M7.7–M7.11, M1.33, L.2, L.4

## Open decisions

| Decision | Options | Notes |
| --- | --- | --- |
| macOS packaging | Root LaunchDaemon vs Network Extension | NE is required for the Mac App Store and means Swift |
| Mapper | Import existing repo vs port code later | |
| Product name | — | Check `.dev` / `.app` via RDAP |

## Decision log

| Date | Decision |
| --- | --- |
| 2026-10-01 | Keep full stack (Postgres, Redis, NATS, separate relay/dns services) to plan for scale |
| 2026-10-01 | Hono instead of Fastify for the API |
| 2026-10-01 | tsup for TS builds, mirroring the erp repo |
| 2026-10-01 | shadcn in its own `packages/ui` |
| 2026-10-01 | Hono RPC (`hc`) for the typed API client instead of GraphQL |
| 2026-10-01 | TypeScript pinned to 5.9 (tsup's dts build doesn't support TS 7 yet) |
| 2026-10-01 | Better Auth organization plugin owns organizations/members/invitations; replaced our own `organizations` table |
| 2026-10-01 | Web and API on separate origins; session cookie works across them because they share a site (`SameSite=Lax`) |
| 2026-10-01 | No hand-written API types: responses are inferred from the Drizzle schema via explicit column selects and Hono RPC. Removed `@meshguard/types` |
| 2026-10-01 | TanStack Query for data fetching and mutations in `web`; shadcn `form` (react-hook-form + zod) for forms |
| 2026-10-01 | Next.js `proxy.ts` guards routes with a server-side Better Auth instance in `web` (`auth.api.getSession`) that reads the shared Postgres, mirroring erp |
| 2026-10-01 | React version pinned workspace-wide with a pnpm catalog; `@meshguard/ui` takes React as a peer dependency |
| 2026-10-01 | API split into routes → controllers (Hono `createHandlers`) → services in `@meshguard/server-core`; one error format with request ids |
| 2026-10-01 | `createLogger` (pino) in `@meshguard/utils` replaces `console` everywhere |
| 2026-10-01 | Organization id always comes from the session (`requireOrganization`), never from request params |
| 2026-10-02 | Three roles (owner, admin, member) on Better Auth access control; definitions shared by API (enforcement) and web (hiding UI) via `@meshguard/auth/permissions` |
| 2026-10-02 | All email goes through BullMQ (`email` queue) to `apps/workers`; templates in `@meshguard/emails` (react-email); Mailpit in dev |
| 2026-10-02 | E2E tests run on a separate Compose profile (`e2e`) with its own database; browser in the official Playwright image so WSL needs no system packages |
| 2026-10-02 | Agent ↔ API uses HTTP/JSON (Hono routes) for the MVP instead of protobuf/gRPC; revisit for the coordination stream |
| 2026-10-02 | Go tests use testify; Go apps `replace` the local `internal` module so they build without go.work |
| 2026-10-02 | Devices authenticate with Ed25519-signed requests (2 min window); agents poll a sync endpoint every 10s rather than a stream for the MVP |
| 2026-10-02 | Relay-first reachability: WebSocket relay (works behind any NAT) before hole punching; peers on a shared network go direct |
| 2026-10-02 | Hole punching via STUN from WireGuard's socket + NaCl-sealed disco pings (Tailscale-style); relay stays the fallback |
| 2026-10-02 | Every network defaults to `10.77.0.0/16` (addresses unique per network only, no global allocator); random IPv6 ULA /48 per network; devices get random free addresses, uniqueness enforced by DB constraints. Relays must route by WireGuard key, never by mesh IP |
| 2026-10-02 | Device presence in Redis (30s TTL key per device); Postgres `last_seen_at` persisted every 5 min only for "last seen" |
| 2026-10-02 | Device events to the web over SSE (one-way, works through the existing cookie/CORS setup) fed by NATS; events are refetch hints, not state |
| 2026-10-02 | Agent local API authorizes by kernel peer credentials on top of the socket's file mode; one level of access (no read-only tier for other users yet) |
| 2026-10-02 | Access rules are enforced by the destination's agent only (it gets just the rules naming it as destination); new networks default to allow, deny is opt-in per network. The agent drops new inbound traffic until its first sync, and treats rules it can't parse as absent (never widening them) |
| 2026-10-02 | Private DNS under `.internal` (ICANN-reserved), answered by each agent from its network map; only `.internal` is routed to it (split DNS), resolv.conf is never rewritten |
| 2026-10-04 | `meshguard doctor` runs in the CLI as the calling user, so DNS, routes, ping and ports are checked the way that user's programs see them; the agent only adds what it alone knows (`/v1/access` evaluates the access rules). A peer's rules are checked by running doctor on that peer, since each agent only gets the rules naming it as destination |
| 2026-10-04 | DNS moves to a resolver address the agent intercepts in its TUN, but stays split: only `.internal` and the mesh's reverse zones go to it. The address is the network's own base + 53, reserved by the API (like a cloud VPC's resolver): already routed into the TUN, no address space beyond the mesh range, and `.53` reads as DNS where `.1` would look like a gateway. Not a fixed address outside the mesh (e.g. in `100.64.0.0/10`), which adds a range that can clash with CGNAT or other VPNs. Forwarding and taking over all DNS (M2.13) wait until something needs them |
| 2026-10-06 | Compared with Tailscale; open work recorded as M1.27–M1.33, M2.14–M2.26, M6 (routes, services, apps), M7 (platform) and L.4, ordered in the Pathway. Identity (devices owned by users, browser login, auth keys) comes before routes and services, which all need it |
