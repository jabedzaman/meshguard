# Architecture

## Repository layout

| Path | What |
| --- | --- |
| `apps/api` | Control plane API (Hono) |
| `apps/web` | Dashboard (Next.js) |
| `apps/workers` | Background jobs (BullMQ), including all email delivery |
| `apps/desktop` | Desktop app (Tauri 2 + React) |
| `apps/mcp` | MCP server |
| `apps/agent` | Device daemon (Go) |
| `apps/cli` | `mesh` CLI (Go) |
| `apps/relay`, `apps/dns` | Relay and DNS services (Go) |
| `internal/` | Shared Go packages |
| `packages/server-core` | Business logic: services, domain errors, queues |
| `packages/auth` | Better Auth setup; `@mesh/auth/permissions` holds the roles |
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
- Log with `createLogger` from `@mesh/utils`, never `console`.

## Auth and roles

Better Auth handles users, sessions, organizations, members and invitations.
Roles (owner, admin, member) are defined once in `@mesh/auth/permissions`; the
API enforces them with `requirePermission(...)` and the web app uses the same
definitions to hide actions (`usePermission(...)`).

In the web app, `proxy.ts` does all routing on auth state (session, active
organization); layouts and pages only load data.

## Device enrollment

A device joins a network with a one-time enrollment token
(`mesh up --token mesh_enr_...`). Tokens are created from the network page,
shown once, and stored only as a SHA-256 hash with a short display prefix.
They expire (1h / 24h / 7d), can be revoked, and are single-use. Members can
create tokens; revoking someone else's needs `device: delete`.

`mesh up --token` asks the local agent (Unix socket) to enroll. The agent
generates an Ed25519 identity key and a Curve25519 WireGuard key, sends only
the public keys to `POST /v1/devices/enroll`, and saves its state (0600) in
`/var/lib/mesh` (`MESH_STATE_DIR` overrides). The API consumes the token and
creates the device in one transaction, picking random free addresses and
retrying on the per-network unique constraints.

## Coordination and WireGuard

Once enrolled, the agent signs every control plane request with its identity
key: `X-Mesh-Device`, `X-Mesh-Timestamp` (unix ms, ±2 min) and
`X-Mesh-Signature` = Ed25519 over `METHOD\npath\ntimestamp\nsha256(body)`
(`packages/server-core/src/lib/device-auth.ts`, `internal/coordination/sign.go`;
both test the same vector).

Every 10s the agent calls `POST /v1/devices/self/sync` with its endpoints
(local interface addresses on the WireGuard port) and gets back the network
map: every peer's WireGuard key, mesh addresses and endpoints. It runs an
embedded wireguard-go on a TUN interface (`mesh0`, `utunN` on macOS), assigns
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
WireGuard transport (`wireguard.Bind`) wraps UDP and sends endpoints written
as `relay/<hex key>` through the relay client. Per peer, the agent uses a
direct endpoint if the peer advertises an address on a network it is attached
to (same LAN), a hole-punched path (below), and the relay otherwise.

## Hole punching

- **STUN.** The agent sends STUN binding requests from WireGuard's own UDP
  socket to the servers in the sync response (`STUN_SERVERS`; `mesh-relay`
  answers STUN on UDP 3478) and advertises the public address it learns.
- **Disco.** While a peer is reachable only via the relay, both agents send
  "disco" pings to each other's candidate endpoints every 2s, from WireGuard's
  socket, which opens NAT mappings. Pings and pongs are NaCl boxes sealed with
  the WireGuard keys, so they can't be forged to redirect traffic. A pong
  confirms the address it came from; the agent points WireGuard at it and
  re-checks every 5s, falling back to the relay after 20s without a pong.
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
`mesh status` explains why WireGuard isn't running.

## Private DNS

Devices resolve as `<name>.internal` (`.internal` is reserved by ICANN for
private use, so it never collides with a public name). Names are DNS labels,
unique per network; the API picks `laptop`, `laptop-2`, … at enrollment.

- The agent serves DNS (`internal/dns`) on its mesh IPv4, port 53, UDP and
  TCP, with A/AAAA records for itself and every peer from the latest network
  map. Unknown names under `.internal` get NXDOMAIN; anything else is refused,
  since the OS only sends `.internal` here.
- Split DNS: macOS reads `/etc/resolver/internal`; on Linux the agent sets
  the resolver and `~internal` routing domain on `mesh0` through
  systemd-resolved. Nothing else on the machine changes, and without
  systemd-resolved the agent leaves resolv.conf alone and says so in
  `mesh status`.
- Names are answered locally, so lookups work offline and never reach the
  control plane. No `mesh-dns` service is involved yet.

## Email

Every email goes through the `email` queue: the API enqueues a job
(`emailQueue.enqueue(template, { to, props })`) and `apps/workers` renders the
react-email template and sends it with nodemailer. The API never talks to SMTP.

## Decisions

The decision log and open questions are in [progress.md](progress.md).
