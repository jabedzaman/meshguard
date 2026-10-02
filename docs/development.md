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

### Running the agent as a service

```sh
sudo mesh-agent install                         # launchd (macOS) / systemd (Linux), starts at boot
sudo mesh-agent install -state-dir $HOME/.mesh  # keep an existing enrollment from a dev run
mesh status                                     # default socket; no sudo or MESH_SOCKET needed
sudo mesh-agent uninstall                       # stops and removes the service, keeps state
```

`install` copies `mesh-agent` (and `mesh`, if it's in the same folder) to
`/usr/local/bin`, saves any agent flags you pass into the service, and makes
the user who ran sudo the socket owner. Logs: `/var/log/mesh-agent.log` on
macOS, `journalctl -u mesh-agent` on Linux.

## Mesh lab

Containerized agents on the e2e stack, around a fake internet (`lab_inet`,
10.200.0.0/24: API .10, relay + STUN .11) and NAT routers:

| Pair | Setup | Must connect |
| --- | --- | --- |
| lab-a ↔ lab-b | same LAN | direct |
| lab-e ↔ lab-f | e behind a NAT router, f public | direct, through e's NAT |
| lab-g ↔ lab-h | g behind a symmetric NAT, h behind a NAT | via relay |

```sh
pnpm e2e:up
pnpm lab        # enrolls each pair, pings v4 both ways and v6, checks the path
docker exec mesh-lab-e mesh status   # public address, "direct" peer
pnpm lab:down
```

`pnpm test:e2e` resets `mesh_test`, which removes the lab's devices; run
`pnpm lab` again afterwards.

## Protobuf

```sh
pnpm proto:gen   # writes packages/proto/gen (gitignored)
```
