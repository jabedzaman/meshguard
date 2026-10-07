# Testing

## Unit tests

```sh
pnpm test   # turbo runs every package's test script: vitest for TypeScript, go test for Go
```

Go tests use [testify](https://github.com/stretchr/testify) (`require` for
preconditions, `assert` for checks) and `httptest` for fake servers.

## End-to-end tests

Playwright specs live in `tests/e2e`. They run against a separate stack (web
:3200, API :4200, database `meshguard_test`, Redis db 1), so they never touch dev
data. The browser runs in Docker, so no system packages are needed.

```sh
pnpm e2e:up        # start api-e2e, web-e2e, workers-e2e and the browser
pnpm test:e2e      # resets meshguard_test, then runs every spec
pnpm test:e2e:ui   # Playwright UI mode
pnpm e2e:down
```

Each test creates its own users (`*@e2e.test`), so specs run in parallel. Use
the fixtures in `tests/e2e/support/fixtures.ts`: `createUser`,
`createOrganization`, `addToOrganization`, `api` and `invitationLink`.

To use a local browser instead, set `E2E_LOCAL_BROWSER=1` (on Linux this needs
`npx playwright install --with-deps chromium`).

## MeshGuard lab

`pnpm lab` (see [development.md](development.md#meshguard-lab)) is the end-to-end
check for the data plane: real agents with WireGuard in containers must ping
each other's mesh IPv4 and IPv6 addresses: directly on a shared LAN, directly
through a NAT router (STUN + hole punching), and through the relay behind a
symmetric NAT. On the LAN pair it also turns on access rules and checks that
pings and TCP ports are blocked and allowed as the rules say. A subnet router
(`lab-r`, with a plain host `lab-s` on a LAN only it can reach) checks that a
route waits for approval, carries traffic once approved and stops when revoked,
when accept-routes is off or when access rules don't allow it. A service hosted by `lab-r` and `lab-a` is used by `lab-b` (names, failover, rules), and `lab-a` shares a localhost-only service with `meshguard serve`. Pebble (a test CA) and its DNS server run in the e2e stack, and `lab-a` gets an HTTPS certificate for its mesh name that `lab-b` verifies against Pebble's root. The same router is an exit node for `lab-b`, whose own traffic to the control plane and relay must keep working around the tunnel.

## Agent service

`pnpm test:systemd` installs the agent with `meshguard-agent install` in a Debian
container running systemd as PID 1 and checks the unit, socket ownership,
restart on crash and uninstall. See [cli.md](cli.md#testing-the-service) for
testing on your own Linux or macOS machine.
