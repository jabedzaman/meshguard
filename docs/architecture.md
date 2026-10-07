# Architecture

## Repository layout

| Path                   | What                                                             |
| ---------------------- | ---------------------------------------------------------------- |
| `apps/api`             | Control plane API (Hono)                                         |
| `apps/web`             | Dashboard (Next.js)                                              |
| `apps/www`             | Website and docs (Next.js + MDX)                                 |
| `apps/workers`         | Background jobs (BullMQ), including all email delivery           |
| `apps/desktop`         | Desktop app (Tauri 2 + React)                                    |
| `apps/mcp`             | MCP server                                                       |
| `apps/agent`           | Device daemon (Go)                                               |
| `apps/cli`             | `meshguard` CLI (Go)                                             |
| `apps/relay`           | Relay and STUN server (Go)                                       |
| `internal/`            | Shared Go packages                                               |
| `packages/server-core` | Business logic: services, domain errors, queues                  |
| `packages/auth`        | Better Auth setup; `@meshguard/auth/permissions` holds the roles |
| `packages/db`          | Drizzle schema and migrations                                    |
| `packages/emails`      | Email templates (react-email)                                    |
| `packages/api-client`  | Typed API client (Hono RPC)                                      |
| `packages/ui`          | shadcn components                                                |
| `packages/utils`       | Shared utilities (`createLogger`)                                |
| `packages/config`      | Zod-validated environment                                        |
| `packages/proto`       | Protobuf contracts                                               |

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

A device belongs to a user: whoever created its enrollment token
(`devices.user_id`), until devices can sign in themselves (M1.28). The network
page shows each device's owner and filters to your own. Members rename and
remove their own devices; owners and admins manage every device. When a user
stops being a member, by removal or by leaving, the API removes their devices
in that organization (`onMemberRemoved` in `@meshguard/auth`: Better Auth's
`afterRemoveMember` hook, plus an after-hook on `/organization/leave`, which
doesn't run it). Deleting the user deletes their devices everywhere.

## Coordination and WireGuard

Once enrolled, the agent signs every control plane request with its identity
key: `X-MeshGuard-Device`, `X-MeshGuard-Timestamp` (unix ms, ±2 min),
`X-MeshGuard-Nonce` (16 random bytes, base64url) and `X-MeshGuard-Signature` =
Ed25519 over `METHOD\npath\ntimestamp\nnonce\nsha256(body)`
(`packages/server-core/src/lib/device-auth.ts`, `internal/coordination/sign.go`;
both test the same vector). The API keeps each device's nonces in Redis for
twice the clock window and refuses one it has seen, so a captured request
can't be replayed. Requests without a nonce (agents older than 3fe6897)
are refused.

The agent calls `POST /v1/devices/self/sync` with its endpoints (local
interface addresses on the WireGuard port) and gets back the network map:
every peer's WireGuard key, mesh addresses and endpoints, plus a `revision`
(a hash of the map without peers' `lastSeenAt`).

Changes are pushed, not polled. Between syncs the agent holds
`POST /v1/devices/self/watch {revision}` open. The API subscribes to the
network's NATS subjects (`network.<id>.>`: device events and
`network.<id>.acl.updated`), re-reads the map on each event, and answers
`changed: true` as soon as its revision differs, or `changed: false` after
50s. The agent then syncs right away, so a new peer, a rename, an endpoint
change or an access rule reaches every agent in about a second. While it
waits, the watch refreshes the device's presence every 10s, so a watching
agent syncs only every 60s (for its endpoints); without a working watch (an
older API answers 404, or errors) it syncs every 10s as before. The whole map
is sent on each change; deltas wait until networks are big enough to need
them. `meshguard status --json` reports `watching`, and `doctor` allows a
90s-old sync while it is. It runs an
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

The relay also needs the control plane's permission. With `RELAY_TOKEN_KEY`
set on the API, every sync's `relay.token` is an Ed25519 signature over the
device's WireGuard key and an expiry (`packages/server-core/src/lib/relay-token.ts`,
`internal/relay/token.go`; both test the same vector). The expiry is the end
of the next 30-minute period, so the token only changes twice an hour. The
agent sends it in its hello, and a new one on the open connection when it
changes. A relay with `RELAY_TRUST_KEY` (the public half) refuses agents
without a valid token and closes a connection whose token expires, so a
removed device loses the relay within an hour and a stranger never gets it.
Without `RELAY_TRUST_KEY` the relay serves any key, as before; set it once
every agent sends tokens. `meshguard-relay -gen-key` prints a pair.

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

## HTTPS certificates

`meshguard cert` gets a TLS certificate for the device's mesh name
(`laptop.brave-otter.mesh.jabed.dev`) that any browser trusts, with no public
address record for the name. The agent makes an ECDSA key and a certificate
request for exactly its own name and sends it to the control plane
(`POST /v1/devices/self/certificate`, signed with the device's identity key).
The control plane checks the request names only that device's name, then orders
the certificate from the ACME directory (`ACME_DIRECTORY_URL`) with one account
per directory, kept in `acme_accounts`. It answers the CA's DNS-01 challenge by
writing the `_acme-challenge.<name>` TXT record in the zone of
`DNS_BASE_DOMAIN` (Cloudflare; Pebble's test DNS in the lab), which is why that
domain must be one the operator owns, and returns the chain. The private key
never leaves the device. The agent keeps the pair under `certs/` in its state
directory and returns it until a third of its lifetime is left; the CLI writes
copies where asked. A device may order five certificates a day, and certificate
authorities limit orders per domain, so use a staging directory while testing.

## Private DNS

Devices resolve as `<name>.<network domain>`, like Tailscale's
`<name>.<tailnet>.ts.net`. Each network gets a random label from two words
when it's created (`networks.dns_label`, unique across all networks, e.g.
`brave-otter`), and its domain is that label under the control plane's
`DNS_BASE_DOMAIN` (`brave-otter.mesh.jabed.dev`; `mesh.jabed.dev` by default). The domain is
computed when the API answers, so changing the base domain renames every
network; it's sent in enrollment and in the network map, and the agent saves
it in its state file. The label says nothing about the organization or
network, so names can go into public certificate logs once HTTPS certificates
exist (M6.6). Device names are DNS labels, unique per network; the API picks
`laptop`, `laptop-2`, … at enrollment.
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
- Split DNS: macOS reads `/etc/resolver/<network domain>` and a file per
  reverse zone; on Linux the agent sets the resolver on `meshguard0` through
  systemd-resolved, with the network's domain as a search domain (short
  names) and the reverse zones as routing-only domains, and never as the
  default route. Nothing else on the machine changes, and without
  systemd-resolved the agent leaves resolv.conf alone and says so in
  `meshguard status`. A new domain from the network map re-points the OS.
- The base domain must have no public wildcard record (none for
  `mesh.jabed.dev`; it's in the jabed.dev Cloudflare zone, which also serves
  the tunnel's hostnames), so a machine whose OS skips the agent gets NXDOMAIN
  rather than someone else's address. `meshguard doctor` still says when a
  mesh name came back as a loopback address, as it would under a wildcard
  domain like `lvh.me`.
- Names are answered locally, so lookups work offline and never reach the
  control plane; there is no central DNS service.

## Access rules

Each network has a default action. `allow` (the default for new networks)
lets every device reach every other. `deny` lets traffic in only when a rule
allows it. A rule has a source and a destination, a protocol (`any`, `tcp`,
`udp`, `icmp`) and, for TCP/UDP, a destination port range. Each side is a
selector (`packages/server-core/src/lib/acl-policy.ts`):

| Selector                                  | Matches                                 |
| ----------------------------------------- | --------------------------------------- |
| `*`                                       | any device                              |
| `device:<id>`                             | one device                              |
| `tag:<name>`                              | devices with that tag                   |
| `user:<id>`                               | the devices that person owns (M1.27)    |
| `role:owner`, `role:admin`, `role:member` | devices owned by members with that role |

Owners and admins tag devices (`PUT /v1/devices/:id/tags`; tags grant access,
so device owners can't tag their own) and manage rules on the network page
(`GET`/`PATCH /v1/networks/:networkId/acl`, `POST .../acl/rules`,
`DELETE /v1/acl-rules/:id`); members can read them. Rules naming a device or
a user are deleted with it. `POST .../acl/check` answers whether one device
may connect to another on a protocol and port, and by which rule;
`GET .../acl/document` is the whole policy with names and emails instead of
ids. Both are on the network page (Check access, View as policy file).

Under `deny`, a device's network map lists only the peers some rule connects
it to, in either direction (`relatedPeers`): a device nothing lets it talk
to isn't configured in WireGuard, doesn't resolve in its DNS, and its key
and endpoints aren't sent. Under `allow` every device gets every peer.

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
- Changes reach agents within a second or two: rule changes publish
  `network.<id>.acl.updated`, and tag and role changes publish events too, so
  watching agents re-sync (see Coordination). Removing a rule stops new
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
