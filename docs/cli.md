# CLI and agent

Two binaries run on each machine:

- **`meshguard-agent`** — the daemon. Owns the device's keys and WireGuard
  interface, syncs with the control plane, relays and hole-punches. Needs root
  to create the network interface.
- **`meshguard`** — the CLI. Talks to the local agent over a Unix socket; never to
  the control plane directly.

## Install

Build (or copy) both binaries, then install the agent as a system service:

```sh
sudo meshguard-agent install
```

This copies `meshguard-agent` (and `meshguard`, if it's in the same folder) to
`/usr/local/bin`, registers a service that starts at boot and restarts if the
agent exits — a **launchd** daemon on macOS, a **systemd** unit on Linux — and
makes you (the user who ran sudo) the owner of the agent socket, so `meshguard`
works without sudo.

The local API is guarded twice: the socket's file mode (only its owner and
root can connect), and the caller's peer credentials, which the kernel reports
for every connection (`SO_PEERCRED` on Linux, `LOCAL_PEERCRED` on macOS). The
agent answers only root, its own user and the socket owner, and refuses
callers it can't identify.

Agent flags passed to `install` are saved into the service, e.g. to keep an
enrollment from a dev run:

```sh
sudo meshguard-agent install -state-dir $HOME/.meshguard
```

Remove the service (binaries and state are kept):

```sh
sudo meshguard-agent uninstall
```

### Updating dev machines

From the repo (Linux/WSL with systemd):

```sh
scripts/reinstall-agent.sh   # build, sudo meshguard-agent install with the service's current flags
scripts/build-mac.sh         # build dist/mac (arm64; pass amd64 for Intel)
```

On the Mac, the first time copy `scripts/mac/update.sh` over (later runs
fetch a fresh copy into `~/Downloads/meshguard`), then:

```sh
~/Downloads/meshguard/update.sh             # scp dist/mac from thinkpad over the mesh, reinstall
~/Downloads/meshguard/update.sh --no-fetch  # reinstall what's already in ~/Downloads/meshguard
~/Downloads/meshguard/uninstall.sh          # remove the service, keep binaries and state
~/Downloads/meshguard/uninstall.sh --purge  # also meshguard logout and delete binaries, state, logs
```

`MESHGUARD_BUILD_HOST` (`user@host`) and `MESHGUARD_BUILD_DIR` point `update.sh`
somewhere else. Both install scripts keep the flags the service already has.
On a machine still running the pre-rename `mesh-agent`, they also move it
over once: its flags and state (keys, enrollment) carry to `meshguard-agent`,
and the old service and binaries are removed.

### Agent flags

| Flag | Default | |
| --- | --- | --- |
| `-socket` | `/var/run/meshguard/agent.sock` (`$MESHGUARD_SOCKET`) | local API socket |
| `-socket-owner` | the sudo user | `uid:gid` that owns the socket and may use the agent without sudo |
| `-state-dir` | `/var/lib/meshguard` (Linux), `/Library/Application Support/MeshGuard` (macOS) (`$MESHGUARD_STATE_DIR`) | keys and enrollment |
| `-port` | `51820` | WireGuard UDP port |
| `-interface` | `meshguard0` (Linux), `utunN` (macOS) | interface name |

Running it in the foreground instead of as a service:
`sudo meshguard-agent -socket /tmp/meshguard.sock -state-dir $HOME/.meshguard`.

### Logs

| | |
| --- | --- |
| macOS | `/var/log/meshguard-agent.log` |
| Linux | `journalctl -u meshguard-agent -f` |

## Commands

Every command accepts `--socket` (default `$MESHGUARD_SOCKET` or
`/var/run/meshguard/agent.sock`) and `--help`. `status`, `peers`, `netcheck`
and `doctor` accept `--json`.

### `meshguard up`

Join a network with a token from the network page (**Add device**), or
reconnect after `meshguard down`.

```sh
meshguard up --token meshguard_enr_...                          # join
meshguard up --token meshguard_enr_... --server https://api.example.com
meshguard up                                               # reconnect after meshguard down
```

`--server` defaults to `$MESHGUARD_SERVER`, then the server baked in at build time
(`MESHGUARD_SERVER=https://... scripts/build-agent.sh`; `http://localhost:4000` if unset). Tokens
work once and expire; a machine already in a network must `meshguard logout` before
joining another.

### `meshguard down`

Disconnect: tears down the WireGuard interface and stops syncing. The device
stays in its network with the same keys and addresses, and stays down across
agent restarts until `meshguard up`. Peers see it go offline.

### `meshguard logout`

Leave the network: removes this device on the control plane, disconnects and
deletes the local keys and state. Joining again needs a new token. If the
control plane can't be reached, it refuses unless you pass `--force` (which
forgets the device locally only; remove it from the web afterwards).

### `meshguard status`

```
thinkpad in home (connected)
  mesh IPv4  10.77.141.90
  mesh IPv6  fda3:ad78:5bac:0:6a19:fb37:e6f8:60e3
  server     http://localhost:4000
  interface  meshguard0
  dns        thinkpad.internal (resolver 100.100.100.53, via systemd-resolved)
  access     only by 2 rules (13 packets refused)
  public     203.0.113.7:51820
  relay      ws://localhost:3340/relay (connected)

peers:
  NAME                DNS                          IPv4         PATH     HANDSHAKE
  jabeds-macbook-air  jabeds-macbook-air.internal  10.77.0.214  relay    6s ago
```

States: `not_enrolled`, `connected`, `enrolled` (registered but not
connected — a `!` line says why, e.g. WireGuard needs root), `down`.

### Private DNS

Every device resolves as `<name>.internal`, e.g. `ssh jabeds-macbook-air.internal`.
Device names come from the hostname (lowercased, first label) and are unique
in the network: a second `laptop` becomes `laptop-2`. Owners and admins can
rename a device on its network page (Rename); peers resolve the new name, and
the device saves it, within one sync (~10s). The old name stops resolving.

Owners and admins can also remove a device there (Remove). Peers drop it on
their next sync, and its agent is refused from then on: `meshguard status`
says the device was removed. To bring it back, run `meshguard logout --force`
on it, then `meshguard up --token <new token>`.

Mesh addresses resolve back to names too (`dig -x 10.77.0.214`).

The agent answers DNS at `100.100.100.53` on every device. Queries to it are
routed into the WireGuard interface, where the agent answers them itself; they
never leave the machine. The OS sends only `.internal` and the mesh's reverse
zones (e.g. `77.10.in-addr.arpa`) there; other lookups never touch it. Test it
with `dig @100.100.100.53 <name>.internal`.

| | |
| --- | --- |
| macOS | writes `/etc/resolver/internal` and one file per reverse zone (removed on `meshguard down`). Short names don't resolve: macOS ignores search domains from these files |
| Linux with systemd-resolved | `resolvectl dns/domain` on `meshguard0`: `internal` as a search domain, so short names work (`ssh laptop`), and the reverse zones as routing-only domains |
| Other Linux | not configured; `meshguard status` says so. Query the resolver directly |

### `meshguard peers`

The peer table on its own. `PATH` is `direct <ip:port>` (LAN or hole-punched)
or `relay`. A handshake older than about 3 minutes means the peer isn't
exchanging traffic.

### `meshguard ip [peer]`

```sh
meshguard ip            # this machine's mesh IPv4
meshguard ip -6         # IPv6
meshguard ip macbook    # a peer's (name, unique prefix, name.internal, or mesh IP)
```

Handy in scripts: `ssh "$(meshguard ip macbook)"`.

### `meshguard ping <peer>`

Pings a peer by name over the mesh (runs the system `ping`), showing which path
it uses. `-c` sets the count, `-6` uses IPv6.

### `meshguard netcheck`

Diagnoses NAT traversal from the WireGuard socket:

```
STUN:
  stun.l.google.com:19302          public 203.0.113.7:51820      23ms
  stun.cloudflare.com:3478         public 203.0.113.7:51820      18ms

NAT:    endpoint-independent (direct connections can work)
relay:  ws://localhost:3340/relay (connected)
advertised endpoints:
  192.168.1.20:51820
  203.0.113.7:51820
```

| NAT | Meaning |
| --- | --- |
| endpoint-independent | Same public address for every server: hole punching can work. |
| symmetric | A different public port per server: direct connections are unlikely; peers use the relay. |
| unknown | Fewer than two STUN servers answered. |

### `meshguard doctor [peer]`

Checks what stands between this machine and its peers, and says how to fix
what it finds. Exits 1 if any check fails (warnings don't).

```
this device
  ✓ agent          running (c43d4de)
  ✓ network        thinkpad in home
  ✓ wireguard      meshguard0 up
  ✓ control plane  synced 4s ago with https://meshguard-api.jabed.dev
  ✓ route          mesh traffic goes through meshguard0
  ✓ relay          connected to wss://meshguard-relay.jabed.dev/relay
  ! nat            symmetric NAT (public 203.0.113.7:52286)
                   → direct connections are unlikely from this network: peers will use the relay
  ✓ dns            thinkpad.internal → 10.77.86.29
  ✓ access         every peer may connect

peers
  ✓ jabeds-macbook-air  direct 192.168.1.43:51820, handshake 30s ago
```

```sh
meshguard doctor                    # this machine and every peer's handshake
meshguard doctor macbook            # the path to a peer: handshake, route, DNS, ping
meshguard doctor macbook --port 22  # ...and whether its TCP port 22 accepts connections
meshguard doctor --port 8080        # can peers reach this machine's port 8080?
```

| Check | What it looks at |
| --- | --- |
| agent | The agent answers, and runs the same build as the CLI. |
| network, wireguard | Enrolled, not down, interface up (needs root). |
| control plane | Synced in the last 30s; otherwise why not. |
| route | The OS sends mesh traffic through the mesh interface, not another VPN that overlaps the range. |
| relay, nat | Relay connected; NAT type from STUN (symmetric means peers use the relay). |
| dns | `<name>.internal` resolves through the OS the way other programs resolve it, including the WSL case where systemd-resolved has the names but `/etc/resolv.conf` points elsewhere. |
| access | This device's access rules; with `--port`, which peers may connect to it. |
| peer | Handshake in the last 3 minutes and the path; with a peer, also ping (no reply with a live handshake usually means the peer's rules don't allow ICMP) and `--port` (refused: nothing listens there; no answer: its access rules or a firewall). |
| listening (`--port` alone) | Something listens on the port on an address peers reach (`0.0.0.0` or the mesh IP), not only `127.0.0.1`, which is a common mistake with Docker's `-p 127.0.0.1:…`. |

Access rules are enforced by the destination, so to see whether a peer lets
this device in, run `meshguard doctor --port N` on that peer. `--json` prints
the checks.

### `meshguard version`

CLI and agent versions.

### Shell completion

```sh
meshguard completion zsh > "${fpath[1]}/_meshguard"     # zsh
meshguard completion bash > /etc/bash_completion.d/meshguard
```

## Troubleshooting

Start with `meshguard doctor` (or `meshguard doctor <peer>`): it runs the checks
below and prints a fix for each problem.

| Symptom | Fix |
| --- | --- |
| `agent not reachable … no agent socket here` | Start the agent: `sudo meshguard-agent install`, or point `--socket` / `MESHGUARD_SOCKET` at where it listens. |
| `agent not reachable … permission denied` | The socket belongs to another user. Reinstall with `sudo meshguard-agent install` as yourself, or run `meshguard` with sudo. |
| `this user may not control the mesh agent` | The socket was reachable but you aren't root, the agent's user or the socket owner. Run `meshguard` with sudo, or reinstall with `sudo meshguard-agent install` as yourself. |
| `! WireGuard is not running … needs root` | The agent isn't running as root. Use the service, or `sudo meshguard-agent`. |
| Peer stays `relay` | Expected behind symmetric NATs, or when both peers are behind home routers (see [architecture.md](architecture.md#hole-punching)). `meshguard netcheck` on both ends shows the NAT types. |
| Peers drop after sleep or a Wi-Fi change | They should come back within ~15s (relay first, then direct). The agent log shows `rebinding reason=wake` or `reason="network change"`; if it doesn't, report it with the log. |
| `dns … not set up in the OS` | No systemd-resolved (common in containers and WSL), or a file in `/etc/resolver` exists and isn't meshguard's. Use `dig @100.100.100.53`, or install systemd-resolved. |
| `.internal` names don't resolve but `dig @100.100.100.53 <name>.internal` answers | macOS: `scutil --dns` should list `100.100.100.53` for `internal`. Linux: `resolvectl status meshguard0` should show `100.100.100.53` and the `internal` domain. |
| Peer handshake `never` | The peer is offline or down (`meshguard status` on it), or the relay is unreachable from one side. |

## Testing the service

- **Automated (systemd):** `pnpm test:systemd` runs `meshguard-agent install` in a
  Debian container with systemd as PID 1 and checks it's enabled and running,
  that a normal user can use `meshguard` without sudo, that systemd restarts a
  killed agent, and that `uninstall` cleans up.
- **On your machine (Linux / WSL with systemd):**

  ```sh
  sudo meshguard-agent install
  systemctl status meshguard-agent           # active (running), enabled
  meshguard status                           # works without sudo
  sudo kill -9 "$(systemctl show -p MainPID --value meshguard-agent)"
  systemctl status meshguard-agent           # restarted with a new PID
  journalctl -u meshguard-agent -f           # logs
  sudo meshguard-agent uninstall
  ```

  WSL needs systemd enabled (`/etc/wsl.conf`: `[boot]` `systemd=true`); check
  with `ps -p 1 -o comm=` (should print `systemd`).
- **On macOS (launchd):**

  ```sh
  sudo ./meshguard-agent install
  sudo launchctl print system/dev.jabed.meshguard.agent | grep -E 'state|pid'
  meshguard status
  sudo kill -9 <pid>                    # launchd restarts it (KeepAlive)
  tail -f /var/log/meshguard-agent.log
  sudo meshguard-agent uninstall
  ```
