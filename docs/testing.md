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
when accept-routes is off or when access rules don't allow it. A service hosted by `lab-r` and `lab-a` is used by `lab-b` (names, failover, rules), and `lab-a` shares a localhost-only service with `meshguard serve`. Pebble (a test CA) and its DNS server run in the e2e stack, and `lab-a` gets an HTTPS certificate for its mesh name that `lab-b` verifies against Pebble's root. The relay runs with a trust key and a public funnel listener, and `lab-f` (on the "internet") reaches a localhost-only service on `lab-a` through it. `lab-r` connects the domain `corp.test` for `lab-b`, which can then reach an app only `lab-r` can. The same router is an exit node for `lab-b`, whose own traffic to the control plane and relay must keep working around the tunnel.

## Agent service

`pnpm test:systemd` installs the agent with `meshguard-agent install` in a Debian
container running systemd as PID 1 and checks the unit, socket ownership,
restart on crash and uninstall. See [cli.md](cli.md#testing-the-service) for
testing on your own Linux or macOS machine.

## Trying the routes and services by hand

`pnpm lab` runs all of this in containers. To try it on your own machines you need two or
three devices in one network (`meshguard status` shows `connected` on each), and for the
data-plane features Linux with root, `iptables` and, for HTTPS and funnels, a control plane
set up for them (see `.env.example`). macOS can use routes and services as a client and
host a service or `serve`; it can't be a subnet router, exit node or connector yet. In the
web, owners and admins approve things on the network page. Commands run on the device named.

Wait a few seconds after a change in the web or with `meshguard set`: agents pick it up
within about a second, but a check right away can still see the old state.

### Device preferences (`meshguard set`, M6.9)

On any device: `meshguard set --advertise-routes 192.168.50.0/24 --accept-routes`, then
`meshguard status` shows both (`advertise-routes`, `accept-routes true`). `meshguard set
--advertise-routes 10.77.0.0/24` is refused (inside the mesh) and so is `0.0.0.0/0` (use an exit
node). Restart the agent: the settings are still there. `meshguard set --advertise-routes ""` clears.

### Subnet routes (M6.1, M6.2)

1. Router `R` (Linux, on a LAN `192.168.50.0/24` with a host `H`): `meshguard set --advertise-routes 192.168.50.0/24`.
2. In the web, the network page shows `192.168.50.0/24 · pending` on `R` and a route icon.
   From another device `C`, `ping H` still fails.
3. Approve it (route icon on `R`, tick the prefix, Save). On `C`: `meshguard set --accept-routes`,
   then `ping 192.168.50.10` and `nc -z 192.168.50.10 8080` work; `ip route get 192.168.50.10`
   (Linux) shows `dev meshguard0`; `meshguard status` shows `accepting` on `C`, `serving` on `R`.
4. Untick the route in the web: `C` loses access within seconds. `meshguard set --accept-routes=false`
   on `C` does the same from its side. On `R`, `sudo iptables -t nat -S POSTROUTING` shows the
   masquerade rule while serving and not after `meshguard set --advertise-routes ""`.
5. With access `deny`, `C` also needs a rule letting it reach `R`.

### Exit nodes (M6.3)

1. `R` (Linux): `meshguard set --advertise-exit-node`; approve "exit node" in the web.
2. `C` (Linux): `meshguard set --exit-node r` (R's device name). `curl ifconfig.me` shows `R`'s
   public address; `meshguard status` shows `exit node ... goes through r`.
3. `ip rule` on `C` shows the `fwmark 0xca6c` rules; `meshguard status` still says `connected`
   (the agent's own traffic stays off the tunnel). `meshguard set --exit-node ""` restores everything.
4. Before approving, `C`'s status says `exit node r isn't offering ... or hasn't approved it yet`.

### Services (M6.4)

1. Web, Services tab: Add service `web` with hosts `H1` and `H2`; note its address (`10.77.x.y`).
2. On both hosts run a listener that says who answers, e.g. `while true; do echo "from $(hostname)" | nc -l 8080 -q 1; done`.
3. On `C`: `meshguard services` lists `web`; `nc web.svc.<network domain> 8080` (or the address)
   prints `from H1`. `dig +short @<resolver> web.svc.<domain>` returns the address
   (`meshguard status` shows the resolver, `10.77.0.53` by default).
4. Stop `H1` (`meshguard down`): after about 30 seconds the same command prints `from H2`.
   Bring `H1` back and it returns to `H1`.
5. With access `deny`, add a rule with destination `service:web` and only that rule lets `C` in.
   Deleting the service removes the rule.

### Sharing a local port (`meshguard serve`, M6.5)

1. On `H`, start something that only listens on localhost: `python3 -m http.server 3000 --bind 127.0.0.1`.
   From a peer `curl http://<H mesh address>:3000` is refused; `meshguard doctor --port 3000` on `H`
   suggests `meshguard serve 3000`.
2. `meshguard serve 3000` on `H`: the same curl works. `meshguard serve` lists it, `--port 8080` uses another
   peer-facing port, `meshguard serve off 3000` stops it. It survives `meshguard down` / `up`.

### HTTPS certificates (`meshguard cert`, M6.6)

Needs the control plane to have `ACME_DIRECTORY_URL` (use Let's Encrypt staging) and a DNS
provider for `DNS_BASE_DOMAIN`. On `H`: `meshguard cert --out ./certs` writes `<name>.crt` and
`<name>.key` (key mode 600); `openssl x509 -in <name>.crt -noout -subject -ext subjectAltName`
shows the mesh name; run it again and it prints `Saved certificate` instantly; `--force` orders a new one.
Serve something with it (`openssl s_server -accept 4443 -cert ... -cert_chain ... -key ... -www`) and
`curl --cacert <staging root> https://<name>:4443/` from a peer succeeds. Without ACME settings the
command says the control plane doesn't issue certificates.

### Funnel (`meshguard funnel`, M6.7)

Needs the relay with `RELAY_TRUST_KEY` and `RELAY_FUNNEL_ADDR=:443`, the API with the matching
`RELAY_TOKEN_KEY`, certificates working, and a DNS record for the device's mesh name pointing at the relay
(set `FUNNEL_PUBLIC_IP` and a DNS provider to have it written).

1. On `H`: run a local web service on `127.0.0.1:3000`, then `meshguard funnel 3000`. `meshguard funnel`
   says `waiting for an owner or admin to turn it on`; a request from the internet to
   `https://<name>/` gets no answer.
2. Web: the globe icon on `H` -> Turn on. Within a minute `meshguard funnel` says `Live: https://<name>`
   (the agent first gets its certificate) and `curl https://<name>/` from any machine returns the service.
3. `meshguard funnel off` or the globe icon -> Turn off ends it at once. Other names on the relay's
   funnel port, and plain HTTP, get no answer.

### App connectors (M6.8)

1. A connector host `G` (Linux) can resolve and reach an app that clients can't, e.g.
   `app.corp.example.com`. Web, Services tab: Add connector `corp`, domains `corp.example.com`, host `G`.
2. On a client `C`: `dig +short @<resolver> app.corp.example.com` returns the address `G` resolves (the
   OS resolver does the same on machines with split DNS), and `curl https://app.corp.example.com` works.
   `meshguard status` shows the connector and `(1 addresses routed)`; `ip route get <address>` shows
   `dev meshguard0` while a neighbouring address does not.
3. `dig @<resolver> example.org` is `REFUSED` (not forwarded). Removing `G` as host or deleting the
   connector takes the routes away within seconds; they also expire 5 minutes after the last lookup.
4. On `G`, `dig @<G's mesh address> app.corp.example.com` answers and `example.org` is refused.
