# mesh

Private mesh networking and remote development environments.

## Layout

| Path | What |
| --- | --- |
| `apps/api` | Control plane API (Hono) |
| `apps/web` | Dashboard (Next.js, `src/` layout) |
| `apps/desktop` | Desktop app (Tauri 2 + React) |
| `apps/mcp` | MCP server |
| `apps/workers` | Background jobs (BullMQ): all email delivery |
| `apps/agent` | Device daemon (Go) |
| `apps/cli` | `mesh` CLI (Go) |
| `apps/relay`, `apps/dns` | Relay and DNS services (Go) |
| `internal/` | Shared Go packages |
| `packages/server-core` | Business logic (services, domain errors) shared by API, MCP and workers |
| `packages/utils` | Shared utilities (`createLogger`) |
| `packages/emails` | Email templates (react-email) |
| `packages/*` | Other shared TypeScript packages and protobuf contracts |

## Prerequisites

- Node 22+, pnpm 9
- Go 1.27+
- Rust (for the desktop app only)
- Docker
- [buf](https://buf.build) for protobuf codegen: `go install github.com/bufbuild/buf/cmd/buf@latest`

## Development

```sh
pnpm install
cp .env.example .env

pnpm docker:up       # postgres, redis, nats, api, web, relay, dns with hot reload
```

Environment variables are injected by Docker Compose from `.env`; apps don't
read `.env` themselves. Each app's dev image lives next to it
(`apps/<app>/Dockerfile.dev`) and runs its `watch` script.

| Service | URL |
| --- | --- |
| Web | http://localhost:3000 |
| API | http://localhost:4000 |
| NATS monitoring | http://localhost:8222 |
| Mailpit (catches all dev email) | http://localhost:8025 |

If a host port is taken by another project, override it in `.env` (see `*_HOST_PORT`).

### Agent and CLI

```sh
MESH_SOCKET=/tmp/mesh.sock pnpm --filter @mesh/agent start
MESH_SOCKET=/tmp/mesh.sock pnpm --filter @mesh/cli start status
```

### Email

Every email goes through the `email` queue: the API enqueues a job
(`enqueueEmail(template, { to, props })`), and `apps/workers` renders the
react-email template and sends it with nodemailer. Preview templates with:

```sh
pnpm --filter @mesh/emails preview   # http://localhost:3030
```

### Protobuf

```sh
pnpm proto:gen   # writes packages/proto/gen (gitignored)
```

### UI components

shadcn components live in `packages/ui`:

```sh
pnpm --filter @mesh/ui ui:add <component>
```

Import them from apps as `@mesh/ui/components/<component>`.



## End-to-end tests

Playwright specs live in `tests/e2e`. They run against a separate stack (web
:3200, API :4200, database `mesh_test`, Redis db 1), so they never touch dev
data. The browser runs in Docker, so no system packages are needed.

```sh
pnpm e2e:up        # start api-e2e, web-e2e, workers-e2e and the browser
pnpm test:e2e      # resets mesh_test, then runs every spec
pnpm test:e2e:ui   # Playwright UI mode
pnpm e2e:down
```

Each test creates its own users (`*@e2e.test`), so specs run in parallel. Use
the fixtures in `tests/e2e/support/fixtures.ts` (`createUser`,
`createOrganization`, `addToOrganization`, `api`, `invitationLink`). To use a
local browser instead, set `E2E_LOCAL_BROWSER=1` (on Linux this needs
`npx playwright install --with-deps chromium`).

## API structure

```
apps/api/src/
  app.ts                      middleware order, error handlers, route mounting
  modules/<feature>/
    <feature>.routes.ts       paths → controller handlers
    <feature>.controller.ts   validate input, call a service, shape the response
  schemas/params.schema.ts    shared path params (idParams, userIdParams)
  middlewares/                auth, error, logging
  lib/                        factory, validator, logger
packages/server-core/src/
  services/<feature>/         database logic; throws AppError subclasses
  errors.ts                   AppError, NotFoundError, ValidationError, ...
```

Controllers use `factory.createHandlers()` so the typed client keeps inferring
params and responses. Errors are returned as
`{ "error": { "code", "message", "details?", "requestId" } }`. Log with
`createLogger` from `@mesh/utils`, never `console`.

## Progress

Goals, milestones and open decisions are tracked in [docs/progress.md](docs/progress.md).
