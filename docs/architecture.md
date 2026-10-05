# Architecture

## Repository layout

| Path | What |
| --- | --- |
| `apps/api` | Control plane API (Hono) |
| `apps/web` | Dashboard (Next.js) |
| `apps/www` | Website and docs (Next.js + MDX) |
| `apps/workers` | Background jobs (BullMQ), including all email delivery |
| `apps/desktop` | Desktop app (Tauri 2 + React) |
| `apps/mcp` | MCP server |
| `apps/agent` | Device daemon (Go) |
| `apps/cli` | `meshguard` CLI (Go) |
| `apps/relay`, `apps/dns` | Relay and DNS services (Go) |
| `internal/` | Shared Go packages |
| `packages/server-core` | Business logic: services, domain errors, queues |
| `packages/auth` | Better Auth setup; `@meshguard/auth/permissions` holds the roles |
| `packages/db` | Drizzle schema and migrations |
| `packages/emails` | Email templates (react-email) |
| `packages/api-client` | Typed API client (Hono RPC) |
| `packages/ui` | shadcn components |
| `packages/utils` | Shared utilities (`createLogger`) |
| `packages/config` | Zod-validated environment |
| `packages/proto` | Protobuf contracts |

## API

```
apps/api/src/
  app.ts                      middleware order, error handlers; mounts /v1
  routes/v1.ts                mounts each feature router under /v1
  modules/<feature>/
    <feature>.routes.ts       paths → controller handlers (nest sub-resources here,
                              e.g. networks mounts /:networkId/enrollment-tokens)
    <feature>.controller.ts   validate input, call a service, shape the response
    <feature>.schema.ts       request body schemas
  schemas/params.schema.ts    shared path params (idParams, networkIdParams, ...)
  middlewares/                auth, error, logging
  lib/                        factory, validator, logger
packages/server-core/src/
  services/<feature>/         database logic; throws AppError subclasses
  errors.ts                   AppError, NotFoundError, ValidationError, ...
```

- Controllers use `factory.createHandlers()` so the typed client keeps inferring
  params and responses. Response types come from the Drizzle schema; there are
  no hand-written DTOs.
- Errors are returned as `{ "error": { "code", "message", "details?", "requestId" } }`.
- The organization id always comes from the session (`requireOrganization`),
  never from request params.
- Log with `createLogger` from `@meshguard/utils`, never `console`.

## Auth and roles

Better Auth handles users, sessions, organizations, members and invitations.
Roles (owner, admin, member) are defined once in `@meshguard/auth/permissions`; the
API enforces them with `requirePermission(...)` and the web app uses the same
definitions to hide actions (`usePermission(...)`).

In the web app, `proxy.ts` does all routing on auth state (session, active
organization); layouts and pages only load data.

## Device enrollment

A device joins a network with a one-time enrollment token
(`meshguard up --token meshguard_enr_...`). Tokens are created from the network page,
shown once, and stored only as a SHA-256 hash with a short display prefix.
They expire (1h / 24h / 7d), can be revoked, and are single-use. Members can
create tokens; revoking someone else's needs `device: delete`.

`meshguard up --token` asks the local agent (Unix socket) to enroll. The agent
generates an Ed25519 identity key and a Curve25519 WireGuard key, sends only
the public keys to `POST /v1/devices/enroll`, and saves its state (0600) in
`/var/lib/meshguard` (`MESHGUARD_STATE_DIR` overrides). The API consumes the token and
creates the device in one transaction, picking random free addresses and
retrying on the per-network unique constraints.

## Coordination and WireGuard

Once enrolled, the agent signs every control plane request with its identity
key: `X-MeshGuard-Device`, `X-MeshGuard-Timestamp` (unix ms, ±2 min) and
`X-MeshGuard-Signature` = Ed25519 over `METHOD\npath\ntimestamp\nsha256(body)`
(`packages/server-core/src/lib/device-auth.ts`, `internal/coordination/sign.go`;
both test the same vector).

Every 10s the agent calls `POST /v1/devices/self/sync` with its endpoints
(local interface addresses on the WireGuard port) and gets back the network
map: every peer's WireGuard key, mesh addresses and endpoints. It runs an
embedded wireguard-go on a TUN interface (`meshguard0`, `utunN` on macOS), assigns
its mesh addresses with the network prefix (so the whole range routes through
the interface) and replaces the peer list when the map changes. Each peer gets
its first endpoint, host routes for its mesh addresses and a 25s keepalive.

Presence lives in Redis, not Postgres: each sync sets
`presence:device:<networkId>:<deviceId>` with a 30s TTL, and a device is online while that key
exists. Postgres is written only when the endpoints change, plus
`last_seen_at` at most every 5 minutes (a `presence:persisted:<id>` NX key
gates it) so offline devices still show when they were last seen.

Device changes are pushed to the web, not polled. The API publishes
`network.<networkId>.device.<type>` on NATS when a device enrolls, connects
(its presence key was absent), changes endpoints or is removed; the workers app
publishes `disconnected` when a presence key expires, from Redis expired-key
notifications (it enables `notify-keyspace-events Ex` at startup; on managed
Redis that forbids `CONFIG`, set it there). The network page holds an
EventSource on `GET /v1/networks/:networkId/devices/events` and re-reads the
device list on every event and on every (re)connect, so events are only hints
and a lost one costs at most a stale row until the next.

## Relay

When peers can't reach each other directly, WireGuard packets go through the
relay (`apps/relay`, `internal/relay`). Agents keep an outbound WebSocket to
it, so it works behind any NAT; it forwards frames of
`[32-byte WireGuard key][packet]` by key and only ever sees ciphertext. On
connect, an agent proves it owns the key it claims: it answers a random
challenge with a NaCl box sealed by its WireGuard private key.

The sync response includes `relay.url` (API env `RELAY_URL`). The agent's
WireGuard transport (`wireguard.Bind`) wraps UDP and the relay client. Every
peer's WireGuard endpoint is `peer/<hex key>` and never changes (roaming is
off); the bind picks the path per packet: the peer's disco-confirmed direct
address (same LAN or hole-punched, below) if there is one, else the relay.
Paths switch the moment disco confirms or loses one, without reconfiguring
WireGuard, so handshakes in flight are never sent to a stale address and a
new peer is reachable over the relay from its first packet.

## Hole punching

- **STUN.** The agent sends STUN binding requests from WireGuard's own UDP
  socket to the servers in the sync response (`STUN_SERVERS`; `meshguard-relay`
  answers STUN on UDP 3478) and advertises the public address it learns.
- **Disco.** While a peer is reachable only via the relay, both agents send
  "disco" pings to each other's candidate endpoints every 2s, from WireGuard's
  socket, which opens NAT mappings. Pings and pongs are NaCl boxes sealed with
  the WireGuard keys, so they can't be forged to redirect traffic. A pong
  confirms the address it came from; the bind sends that peer's packets there and
  re-checks every 5s, falling back to the relay after 20s without a pong. A
  working path is only replaced by one at least a third faster (by round
  trip), or once it misses a check: when searching, every candidate answers,
  and a slow one (e.g. hairpinned through the router via a public address)
  must not win by answering last. Each switch is logged ("direct path").
- **Learning from pings.** A valid ping's source address is the peer's real
  NAT mapping toward us (it can differ from the STUN result after a port
  clash), so it is pinged back too.
- **Following a peer.** A confirmed path that misses a keepalive goes back
  to pinging every candidate, and a ping from a new address is pinged back,
  so a peer that moved is found before its old path expires.
- **Network changes and sleep.** The agent checks its local addresses every
  2s and compares the wall clock with Go's monotonic clock (which stops
  during sleep). On a change or a wake it reopens WireGuard's sockets, drops
  the STUN result and confirmed paths, redials the relay, re-probes STUN and
  syncs right away. Peers use the relay until disco finds direct paths again
  (`pnpm lab` moves a peer to a new address: direct again in ~13s, bounded by
  the 10s sync). The relay connection is also pinged every 15s, so a
  half-open connection is replaced.
- `wireguard.Bind` hands STUN and disco packets to the agent and everything
  else to WireGuard; they're told apart by their first bytes.

What this covers today: peers on the same LAN, and one side behind NAT with
the other reachable (public IP, VPS, port forward). When both sides are behind
Linux-style NATs, the first probe to arrive creates a conntrack entry that
clashes with the other side's mapping, so punching fails and traffic stays on
the relay; symmetric NATs also stay on the relay. Next options: coordinated
simultaneous punching, the low-TTL trick, and UPnP / NAT-PMP / PCP port
mappings. Without root the agent stays registered and syncing, and
`meshguard status` explains why WireGuard isn't running.

## Private DNS

Devices resolve as `<name>.internal` (`.internal` is reserved by ICANN for
private use, so it never collides with a public name). Names are DNS labels,
unique per network; the API picks `laptop`, `laptop-2`, … at enrollment.
Owners and admins rename devices (`PATCH /v1/devices/:id`, 409
`device_name_taken` on a clash); the next sync carries the new name to every
agent, and each agent saves its own in its state file. Removing a device
(`DELETE /v1/devices/:id`) deletes its row and presence; peers drop it on
their next sync, and its own signed requests get 401 `invalid_device_signature`,
the same answer as an unknown device, so ids can't be probed.

- The resolver is the network's address + 53 (`10.77.0.53` in
  `10.77.0.0/16`), which the API never gives a device. It's inside the mesh
  range, so it needs no extra route or address space of its own, and can't
  clash with anything the mesh range doesn't already clash with. The agent
  catches UDP queries to its port 53 in its TUN as the OS writes them
  (`filteredTUN`), before WireGuard: they're answered and written straight
  back to the OS, never reach a peer, and no socket is bound. Only UDP: the
  answers are small enough never to be truncated.
- The agent (`internal/dns`) answers A/AAAA for itself and every peer from the
  latest network map, and PTR in the network's reverse zones
  (`77.10.in-addr.arpa`; a prefix between octets becomes the longer zones
  inside it, never a shorter one). Unknown names in those zones get NXDOMAIN;
  anything else is refused, since the OS only sends those zones here.
- Split DNS: macOS reads `/etc/resolver/internal` and a file per reverse zone;
  on Linux the agent sets the resolver on `meshguard0` through
  systemd-resolved, with `internal` as a search domain (short names) and the
  reverse zones as routing-only domains, and never as the default route.
  Nothing else on the machine changes, and without systemd-resolved the agent
  leaves resolv.conf alone and says so in `meshguard status`.
- Names are answered locally, so lookups work offline and never reach the
  control plane. No `meshguard-dns` service is involved yet.

## Access rules

Each network has a default action. `allow` (the default for new networks)
lets every device reach every other. `deny` lets traffic in only when a rule
allows it. A rule names a source (one device, or any device), a
destination (one device, or every device), a protocol (`any`, `tcp`, `udp`,
`icmp`) and, for TCP/UDP, a destination port range. Owners and admins manage
them on the network page (`GET`/`PATCH /v1/networks/:networkId/acl`,
`POST .../acl/rules`, `DELETE /v1/acl-rules/:id`); members can read them.
Rules naming a device are deleted with it.

Enforcement happens at the destination. On sync each agent gets only the rules
that let traffic in to it, with sources resolved to mesh addresses
(`acl.inbound`). The agent wraps WireGuard's TUN (`internal/acl`,
`internal/wireguard/filter.go`):

- Packets from peers (written to the TUN) are dropped unless a rule matches
  the source address, protocol and destination port. WireGuard's allowed IPs
  already pin each peer to its mesh addresses, so the source can't be forged.
- Packets to peers (read from the TUN) are recorded as flows for 5 minutes,
  so replies to connections this device opened always get back, as do echo
  replies to its pings. ICMP errors (unreachable, packet too big) and
  non-first fragments pass too.
- Until its first sync the agent lets only replies in. A control plane that
  sends no `acl` (older API) means allow. Rules the agent can't parse are
  skipped, which can only deny more.
- Changes reach agents on their next sync (≤10s). Removing a rule stops new
  connections. A connection that is already open stays up while the
  destination keeps answering, because its replies are tracked as flows.

`meshguard status` shows the rules in effect and how many packets were
refused.

## Email

Every email goes through the `email` queue: the API enqueues a job
(`emailQueue.enqueue(template, { to, props })`) and `apps/workers` renders the
react-email template and sends it with nodemailer. The API never talks to SMTP.

## Decisions

The decision log and open questions are in [progress.md](progress.md).
