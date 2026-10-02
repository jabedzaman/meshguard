# Testing

## Unit tests

```sh
pnpm test   # turbo runs every package's test script: vitest for TypeScript, go test for Go
```

Go tests use [testify](https://github.com/stretchr/testify) (`require` for
preconditions, `assert` for checks) and `httptest` for fake servers.

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
the fixtures in `tests/e2e/support/fixtures.ts`: `createUser`,
`createOrganization`, `addToOrganization`, `api` and `invitationLink`.

To use a local browser instead, set `E2E_LOCAL_BROWSER=1` (on Linux this needs
`npx playwright install --with-deps chromium`).

## Mesh lab

`pnpm lab` (see [development.md](development.md#two-device-lab)) is the
end-to-end check for the data plane: two real agents with WireGuard in
containers must ping each other's mesh IPv4 and IPv6 addresses.
