# meshguard

Private mesh networking and remote development environments.

## Quick start

```sh
pnpm install
cp .env.example .env
pnpm docker:up
```

Web: http://localhost:3000 · API: http://localhost:4000 · Mail: http://localhost:8025

## Docs

- [Development](docs/development.md): setup, services, everyday commands
- [CLI and agent](docs/cli.md): install the agent, every `meshguard` command, troubleshooting
- [Architecture](docs/architecture.md): repo layout, API structure, auth, email
- [Testing](docs/testing.md): unit and end-to-end tests
- [Deploy](deploy/README.md): k3s + Cloudflare Tunnel on the homelab
- [Progress](docs/progress.md): milestones, open decisions, decision log
