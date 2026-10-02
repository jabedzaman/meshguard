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
| Relay | ws://localhost:3340/relay (health: http://localhost:3340/healthz) |
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

Creating the WireGuard interface needs root. Without it the agent still
enrolls and syncs, and `mesh status` says WireGuard isn't running. To connect
for real, run it with sudo and pass the paths as flags (sudo may drop env vars):

```sh
sudo ~/.local/bin/mesh-agent -socket /tmp/mesh.sock -state-dir $HOME/.mesh
```

Under sudo the agent hands the socket to the invoking user, so `mesh` works
without sudo.

## Mesh lab

Four containerized agents on the e2e stack. `lab-a` and `lab-b` share a Docker
network and must connect directly; `lab-c` and `lab-d` are on isolated
networks (they can reach the API and relay, not each other) and must connect
through the relay:

```sh
pnpm e2e:up
pnpm lab        # enrolls both pairs, pings v4 both ways and v6, checks the path
docker exec mesh-lab-c mesh status   # peers "via relay"
pnpm lab:down
```

`pnpm test:e2e` resets `mesh_test`, which removes the lab's devices; run
`pnpm lab` again afterwards.

## Protobuf

```sh
pnpm proto:gen   # writes packages/proto/gen (gitignored)
```
