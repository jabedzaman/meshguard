# meshguard

Private mesh networking and remote development environments.

## Quick start

```sh
pnpm install
cp .env.example .env
pnpm docker:up
```

Web: http://localhost:3000 · API: http://localhost:4000 · Mail: http://localhost:8025

## Native macOS app (untested)

> [!WARNING]
> `apps/macos` (SwiftUI app with a Network Extension packet tunnel) has **not been run or tested** as a signed app. A Network Extension needs the paid Apple Developer Program, and the author does not have access to it yet. A free Personal Team is refused (`Personal development teams … do not support the Network Extensions capability`). It only builds unsigned; the tunnel, system extension activation and the glass UI against real data are unverified. Until then the macOS agent is the root LaunchDaemon (`meshguard-agent install`), which is tested on real hardware. See M3.8 in [Progress](docs/progress.md).

## Docs

- [Development](docs/development.md): setup, services, everyday commands
- [CLI and agent](docs/cli.md): install the agent, every `meshguard` command, troubleshooting
- [Architecture](docs/architecture.md): repo layout, API structure, auth, email
- [Testing](docs/testing.md): unit and end-to-end tests
- [Deploy](deploy/README.md): k3s + Cloudflare Tunnel on the homelab
- [Progress](docs/progress.md): milestones, open decisions, decision log
