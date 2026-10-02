# Development

## Prerequisites

- Node 22+, pnpm 9
- Docker
- Go 1.27+ (agent, CLI, relay, DNS)
- Rust (desktop app only)
- [buf](https://buf.build) for protobuf codegen: `go install github.com/bufbuild/buf/cmd/buf@latest`

## Running the stack

```sh
pnpm install
cp .env.example .env
pnpm docker:up       # postgres, redis, nats, mailpit, api, web, workers, relay, dns
pnpm docker:down
```

Docker is the dev environment. Each app's dev image lives next to it
(`apps/<app>/Dockerfile.dev`) and runs its `watch` script with hot reload.
Environment variables are injected by Docker Compose from `.env`; apps never
read `.env` themselves.

| Service | URL |
| --- | --- |
| Web | http://localhost:3000 |
| API | http://localhost:4000 |
| Mailpit (catches all dev email) | http://localhost:8025 |
| NATS monitoring | http://localhost:8222 |

If a host port is taken by another project, override it in `.env` (`*_HOST_PORT`).

After adding a dependency to an app, rebuild its image:

```sh
docker compose up -d --build --no-deps <service>
```

## Database

```sh
pnpm --filter @mesh/db db:generate   # migration from schema changes
pnpm --filter @mesh/db db:migrate    # apply to DATABASE_URL
pnpm --filter @mesh/auth auth:generate   # regenerate Better Auth tables (packages/db/src/schema/auth.ts)
```

## Email templates

```sh
pnpm --filter @mesh/emails preview   # http://localhost:3030
```

## UI components

shadcn components live in `packages/ui` and are imported as
`@mesh/ui/components/<component>`:

```sh
pnpm --filter @mesh/ui ui:add <component>
pnpm --filter @mesh/ui ui:add --overwrite <component>   # if it depends on existing components
```

## Agent and CLI

Run an unprivileged dev agent with its socket and state in a temp dir, then
enroll it with a token from a network's **Add device** dialog:

```sh
export MESH_SOCKET=/tmp/mesh.sock MESH_STATE_DIR=/tmp/mesh-state
pnpm --filter @mesh/agent start &
pnpm --filter @mesh/cli start up --token mesh_enr_...   # server: $MESH_SERVER or http://localhost:4000
pnpm --filter @mesh/cli start status
```

Unix socket paths are limited to ~100 characters; keep `MESH_SOCKET` short.

## Protobuf

```sh
pnpm proto:gen   # writes packages/proto/gen (gitignored)
```
