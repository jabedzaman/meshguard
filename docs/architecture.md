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

Devices are shown online if they synced in the last 30s.

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
to (same LAN), and the relay otherwise. STUN-based hole punching, to go direct
across NATs, comes next. Without root the agent stays registered and syncing, and
`mesh status` explains why WireGuard isn't running.

## Email

Every email goes through the `email` queue: the API enqueues a job
(`emailQueue.enqueue(template, { to, props })`) and `apps/workers` renders the
react-email template and sends it with nodemailer. The API never talks to SMTP.

## Decisions

The decision log and open questions are in [progress.md](progress.md).
