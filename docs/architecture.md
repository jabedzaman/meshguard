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

## Email

Every email goes through the `email` queue: the API enqueues a job
(`emailQueue.enqueue(template, { to, props })`) and `apps/workers` renders the
react-email template and sends it with nodemailer. The API never talks to SMTP.

## Decisions

The decision log and open questions are in [progress.md](progress.md).
