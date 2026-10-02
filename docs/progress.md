# Progress

Status of goals and milestones. Update this file in the same commit as the work it describes.

Legend: ✅ done · 🚧 in progress · ⬜ not started

## North star

> Install → Sign in → Devices appear → Click workspace → Everything connects.

Networking should disappear into the workflow.

## Milestones

### M0 — Repo bootstrap ✅

- ✅ pnpm + Turborepo monorepo, `~/*` import alias
- ✅ Apps: `api` (Hono), `web` (Next.js), `desktop` (Tauri 2), `mcp`, `agent`, `cli`, `relay`, `dns` (Go)
- ✅ Packages: `config`, `db`, `auth`, `api-client`, `mcp-sdk`, `ui` (shadcn), `proto`
- ✅ TS packages built with tsup, apps run with `tsx watch`
- ✅ Go workspace (`go.work`) with shared `internal/` module
- ✅ Protobuf contracts linted and generated with buf
- ✅ Docker dev env: Postgres, Redis, NATS + api/web/relay/dns with hot reload (`apps/<app>/Dockerfile.dev`, env injected by Compose)
- ✅ Typed API client via Hono RPC (`hc<AppType>`), sample `/v1/networks` route
- ✅ First Drizzle migration (organizations, networks, devices)
- ✅ Playwright e2e suite (`pnpm e2e:up && pnpm test:e2e`) on an isolated stack and `mesh_test` database

### M1 — Working private mesh (the real MVP) 🚧

Goal: Mac A and Mac B on different networks can ping each other's mesh IP, directly over WireGuard, and recover from disconnects automatically.

- ✅ Human auth: Better Auth email/password sign-up/sign-in in `api` and `web`
- 🚧 GitHub sign-in: wired, needs an OAuth app (`GITHUB_CLIENT_ID/SECRET`)
- ✅ Organizations: Better Auth organization plugin, onboarding in `web`, active org restored on sign-in
- ✅ `/v1` routes require a session and are scoped to the active organization
- ✅ `web` route protection via Next.js proxy with `redirectTo`
- ✅ All auth routing in `web/proxy.ts` (session, active org); layouts only load data; onboarding at `/organizations/create`; `/api/organizations/[organizationId]/activate` restores a missing active org
- ✅ Networks: create (`POST /v1/networks`), default `10.77.0.0/16` (configurable, RFC 1918 only), random IPv6 ULA /48 per network
- ✅ Organization switcher
- ✅ Roles: owner / admin / member (`@mesh/auth/permissions`), enforced in the API with `requirePermission`
- ✅ Invitations: invite by email (owner/admin), pending list, cancel; email via workers + react-email
- ✅ Invitation page `/invitations/[invitationId]`: accept / decline, sign-up from the link, wrong-account, expired / cancelled / used states
- ✅ Role assignment on the members list (owners: any role; admins: admin/member, not owners; own row read-only)
- ✅ Remove member (owners/admins; only owners act on owners) and leave organization (proxy then activates the next org)
- ⬜ Member search (when orgs grow); stale active org on a leaver's other devices (layout fallback)
- ⬜ Device address allocation (random free address, unique per network; enforced by DB constraints)
- ⬜ Device identity: agent generates identity + WireGuard key pairs, stores them securely
- ✅ Enrollment tokens: create (shown once, hashed), list active, revoke; network page with Add device
- ⬜ Enrollment: agent redeems token → device record → mesh IP assigned
- ⬜ Coordination: agent receives network map stream, applies peer config
- ⬜ WireGuard on macOS: userspace `wireguard-go` + utun, routes for mesh range
- ⬜ Endpoint discovery: report local + STUN-observed endpoints
- ⬜ NAT traversal: UDP hole punching between peers
- ⬜ Heartbeats + presence (Redis), device online/offline
- ⬜ Reconnect after sleep / network change
- ⬜ `mesh login`, `mesh status`, `mesh devices`, `mesh connect`, `mesh disconnect`
- ⬜ Agent local API auth (peer credentials on the Unix socket)

### M2 — Reachability and naming ⬜

- ⬜ Relay fallback when direct connection fails
- ⬜ Private DNS (`<device>.<tld>`), answered locally by the agent
- ⬜ ACLs (device → service → port)
- ⬜ Key rotation

### M3 — Desktop app ⬜

- ⬜ Sign in, device enrollment, network selection
- ⬜ Device list, peer health, connection status
- ⬜ Agent ↔ desktop over Unix socket
- ⬜ Menu-bar mode (carry over from Mapper)

### M4 — Workspaces ⬜

- ⬜ Workspace config schema (`workspace.yaml`)
- ⬜ Activate / deactivate: remote checks, Docker Compose up, port forwarding
- ⬜ Port conflict detection and resolution
- ⬜ Service discovery, open URLs
- ⬜ Git status / diff
- ⬜ `mesh workspace list|activate|stop`

### M5 — AI and diagnostics ⬜

- ⬜ `mesh doctor`: peer, handshake, route, ACL, DNS, port, Docker checks
- ⬜ MCP read-only tools (devices, topology, workspace, git, logs)
- ⬜ MCP mutating tools behind explicit approval
- ⬜ AI network doctor built on `mesh doctor`

### Later ⬜

- ⬜ Temporary access links (time-limited, audited)
- ⬜ Windows and Linux agents
- ⬜ Product name + domain

## Open decisions

| Decision | Options | Notes |
| --- | --- | --- |
| Private DNS TLD | `.internal` vs `.mesh` vs owned subdomain | `.internal` is ICANN-reserved for private use; `.mesh` is not reserved |
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
| 2026-10-01 | No hand-written API types: responses are inferred from the Drizzle schema via explicit column selects and Hono RPC. Removed `@mesh/types` |
| 2026-10-01 | TanStack Query for data fetching and mutations in `web`; shadcn `form` (react-hook-form + zod) for forms |
| 2026-10-01 | Next.js `proxy.ts` guards routes with a server-side Better Auth instance in `web` (`auth.api.getSession`) that reads the shared Postgres, mirroring erp |
| 2026-10-01 | React version pinned workspace-wide with a pnpm catalog; `@mesh/ui` takes React as a peer dependency |
| 2026-10-01 | API split into routes → controllers (Hono `createHandlers`) → services in `@mesh/server-core`; one error format with request ids |
| 2026-10-01 | `createLogger` (pino) in `@mesh/utils` replaces `console` everywhere |
| 2026-10-01 | Organization id always comes from the session (`requireOrganization`), never from request params |
| 2026-10-02 | Three roles (owner, admin, member) on Better Auth access control; definitions shared by API (enforcement) and web (hiding UI) via `@mesh/auth/permissions` |
| 2026-10-02 | All email goes through BullMQ (`email` queue) to `apps/workers`; templates in `@mesh/emails` (react-email); Mailpit in dev |
| 2026-10-02 | E2E tests run on a separate Compose profile (`e2e`) with its own database; browser in the official Playwright image so WSL needs no system packages |
| 2026-10-02 | Every network defaults to `10.77.0.0/16` (addresses unique per network only, no global allocator); random IPv6 ULA /48 per network; devices get random free addresses, uniqueness enforced by DB constraints. Relays must route by WireGuard key, never by mesh IP |
