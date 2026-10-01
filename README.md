# mesh

Private mesh networking and remote development environments.

## Layout

| Path | What |
| --- | --- |
| `apps/api` | Control plane API (Hono) |
| `apps/web` | Dashboard (Next.js, `src/` layout) |
| `apps/desktop` | Desktop app (Tauri 2 + React) |
| `apps/mcp` | MCP server |
| `apps/agent` | Device daemon (Go) |
| `apps/cli` | `mesh` CLI (Go) |
| `apps/relay`, `apps/dns` | Relay and DNS services (Go) |
| `internal/` | Shared Go packages |
| `packages/*` | Shared TypeScript packages and protobuf contracts |

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
pnpm docker:infra    # or only postgres, redis and nats, then run apps on the host:
pnpm dev
```

| Service | URL |
| --- | --- |
| Web | http://localhost:3000 |
| API | http://localhost:4000 |
| NATS monitoring | http://localhost:8222 |

If a host port is taken by another project, override it in `.env` (see `*_HOST_PORT`).

### Agent and CLI

```sh
cd apps/agent && MESH_SOCKET=/tmp/mesh.sock go run ./cmd/mesh-agent
cd apps/cli && MESH_SOCKET=/tmp/mesh.sock go run ./cmd/mesh status
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


