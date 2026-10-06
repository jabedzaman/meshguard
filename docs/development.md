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
pnpm docker:up       # postgres, redis, nats, mailpit, api, web, www, workers, relay
pnpm docker:down
```

Docker is the dev environment. Each app's dev image lives next to it
(`apps/<app>/Dockerfile.dev`) and runs its `watch` script with hot reload.
Environment variables are injected by Docker Compose from `.env`; apps never
read `.env` themselves.

| Service | URL |
| --- | --- |
| Web | http://localhost:3000 |
| Website and docs | http://localhost:3002/docs |
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
pnpm --filter @meshguard/db db:generate   # migration from schema changes
pnpm --filter @meshguard/db db:migrate    # apply to DATABASE_URL
pnpm --filter @meshguard/auth auth:generate   # regenerate Better Auth tables (packages/db/src/schema/auth.ts)
```

## Email templates

```sh
pnpm --filter @meshguard/emails preview   # http://localhost:3030
```

## UI components

shadcn components live in `packages/ui` and are imported as
`@meshguard/ui/components/<component>`:

```sh
pnpm --filter @meshguard/ui ui:add <component>
pnpm --filter @meshguard/ui ui:add --overwrite <component>   # if it depends on existing components
```

## Agent and CLI

See [cli.md](cli.md) for installing the agent and every `meshguard` command. For a
quick dev run without installing the service:

```sh
sudo ~/.local/bin/meshguard-agent -socket /tmp/meshguard.sock -state-dir $HOME/.meshguard
MESHGUARD_SOCKET=/tmp/meshguard.sock meshguard up --token meshguard_enr_...
```

## MeshGuard lab

Containerized agents on the e2e stack, around a fake internet (`lab_inet`,
10.200.0.0/24: API .10, relay + STUN .11) and NAT routers:

| Pair | Setup | Must connect |
| --- | --- | --- |
| lab-a ↔ lab-b | same LAN | direct |
| lab-e ↔ lab-f | e behind a NAT router, f public | direct, through e's NAT |
| lab-g ↔ lab-h | g behind a symmetric NAT, h behind a NAT | via relay |

```sh
pnpm e2e:up
pnpm lab        # enrolls each pair, pings v4 both ways and v6, checks the path and access rules
docker exec meshguard-lab-e meshguard status   # public address, "direct" peer
pnpm lab:down
```

`pnpm test:e2e` resets `meshguard_test`, which removes the lab's devices; run
`pnpm lab` again afterwards.

## Protobuf

```sh
pnpm proto:gen   # writes packages/proto/gen (gitignored)
```

## Writing docs

The public docs live in `apps/www` (`pnpm -F @meshguard/www watch`, then
http://localhost:3002/docs). Each page is an MDX file under
`apps/www/src/content/docs` with a `title` (and optional `description`) in its
frontmatter; the URL follows the path, and `index.mdx` is its folder's page. A
folder's `meta.json` sets its sidebar title and page order:

```json
{ "title": "CLI", "pages": ["commands", "private-dns", "agent"] }
```

Besides Markdown, pages can use `<Callout title="...">` and `<Steps>` (numbers
each `###` heading inside).
