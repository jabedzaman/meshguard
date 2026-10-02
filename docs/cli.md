# CLI and agent

Two binaries run on each machine:

- **`mesh-agent`** — the daemon. Owns the device's keys and WireGuard
  interface, syncs with the control plane, relays and hole-punches. Needs root
  to create the network interface.
- **`mesh`** — the CLI. Talks to the local agent over a Unix socket; never to
  the control plane directly.

## Install

Build (or copy) both binaries, then install the agent as a system service:

```sh
sudo mesh-agent install
```

This copies `mesh-agent` (and `mesh`, if it's in the same folder) to
`/usr/local/bin`, registers a service that starts at boot and restarts if the
agent exits — a **launchd** daemon on macOS, a **systemd** unit on Linux — and
makes you (the user who ran sudo) the owner of the agent socket, so `mesh`
works without sudo.

Agent flags passed to `install` are saved into the service, e.g. to keep an
enrollment from a dev run:

```sh
sudo mesh-agent install -state-dir $HOME/.mesh
```

Remove the service (binaries and state are kept):

```sh
sudo mesh-agent uninstall
```

### Agent flags

| Flag | Default | |
| --- | --- | --- |
| `-socket` | `/var/run/mesh/agent.sock` (`$MESH_SOCKET`) | local API socket |
| `-socket-owner` | the sudo user | `uid:gid` that may use the socket without sudo |
| `-state-dir` | `/var/lib/mesh` (Linux), `/Library/Application Support/Mesh` (macOS) (`$MESH_STATE_DIR`) | keys and enrollment |
| `-port` | `51820` | WireGuard UDP port |
| `-interface` | `mesh0` (Linux), `utunN` (macOS) | interface name |

Running it in the foreground instead of as a service:
`sudo mesh-agent -socket /tmp/mesh.sock -state-dir $HOME/.mesh`.

### Logs

| | |
| --- | --- |
| macOS | `/var/log/mesh-agent.log` |
| Linux | `journalctl -u mesh-agent -f` |

## Commands

Every command accepts `--socket` (default `$MESH_SOCKET` or
`/var/run/mesh/agent.sock`) and `--help`. `status`, `peers` and `netcheck`
accept `--json`.

### `mesh up`

Join a network with a token from the network page (**Add device**), or
reconnect after `mesh down`.

```sh
mesh up --token mesh_enr_...                          # join
mesh up --token mesh_enr_... --server https://api.example.com
mesh up                                               # reconnect after mesh down
```

`--server` defaults to `$MESH_SERVER`, then `http://localhost:4000`. Tokens
work once and expire; a machine already in a network must `mesh logout` before
joining another.

### `mesh down`

Disconnect: tears down the WireGuard interface and stops syncing. The device
stays in its network with the same keys and addresses, and stays down across
agent restarts until `mesh up`. Peers see it go offline.

### `mesh logout`

Leave the network: removes this device on the control plane, disconnects and
deletes the local keys and state. Joining again needs a new token. If the
control plane can't be reached, it refuses unless you pass `--force` (which
forgets the device locally only; remove it from the web afterwards).

### `mesh status`

```
thinkpad in home (connected)
  mesh IPv4  10.77.141.90
  mesh IPv6  fda3:ad78:5bac:0:6a19:fb37:e6f8:60e3
  server     http://localhost:4000
  interface  mesh0
  public     203.0.113.7:51820
  relay      ws://localhost:3340/relay (connected)

peers:
  NAME                IPv4         PATH     HANDSHAKE
  Jabeds-MacBook-Air  10.77.0.214  relay    6s ago
```

States: `not_enrolled`, `connected`, `enrolled` (registered but not
connected — a `!` line says why, e.g. WireGuard needs root), `down`.

### `mesh peers`

The peer table on its own. `PATH` is `direct <ip:port>` (LAN or hole-punched)
or `relay`. A handshake older than about 3 minutes means the peer isn't
exchanging traffic.

### `mesh ip [peer]`

```sh
mesh ip            # this machine's mesh IPv4
mesh ip -6         # IPv6
mesh ip macbook    # a peer's (name, unique prefix, or mesh IP)
```

Handy in scripts: `ssh "$(mesh ip macbook)"`.

### `mesh ping <peer>`

Pings a peer by name over the mesh (runs the system `ping`), showing which path
it uses. `-c` sets the count, `-6` uses IPv6.

### `mesh netcheck`

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

### `mesh version`

CLI and agent versions.

### Shell completion

```sh
mesh completion zsh > "${fpath[1]}/_mesh"     # zsh
mesh completion bash > /etc/bash_completion.d/mesh
```

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `agent not reachable … no agent socket here` | Start the agent: `sudo mesh-agent install`, or point `--socket` / `MESH_SOCKET` at where it listens. |
| `agent not reachable … permission denied` | The socket belongs to another user. Reinstall with `sudo mesh-agent install` as yourself, or run `mesh` with sudo. |
| `! WireGuard is not running … needs root` | The agent isn't running as root. Use the service, or `sudo mesh-agent`. |
| Peer stays `relay` | Expected behind symmetric NATs, or when both peers are behind home routers (see [architecture.md](architecture.md#hole-punching)). `mesh netcheck` on both ends shows the NAT types. |
| Peers drop after sleep or a Wi-Fi change | They should come back within ~15s (relay first, then direct). The agent log shows `rebinding reason=wake` or `reason="network change"`; if it doesn't, report it with the log. |
| Peer handshake `never` | The peer is offline or down (`mesh status` on it), or the relay is unreachable from one side. |

## Testing the service

- **Automated (systemd):** `pnpm test:systemd` runs `mesh-agent install` in a
  Debian container with systemd as PID 1 and checks it's enabled and running,
  that a normal user can use `mesh` without sudo, that systemd restarts a
  killed agent, and that `uninstall` cleans up.
- **On your machine (Linux / WSL with systemd):**

  ```sh
  sudo mesh-agent install
  systemctl status mesh-agent           # active (running), enabled
  mesh status                           # works without sudo
  sudo kill -9 "$(systemctl show -p MainPID --value mesh-agent)"
  systemctl status mesh-agent           # restarted with a new PID
  journalctl -u mesh-agent -f           # logs
  sudo mesh-agent uninstall
  ```

  WSL needs systemd enabled (`/etc/wsl.conf`: `[boot]` `systemd=true`); check
  with `ps -p 1 -o comm=` (should print `systemd`).
- **On macOS (launchd):**

  ```sh
  sudo ./mesh-agent install
  sudo launchctl print system/dev.twinlabs.mesh.agent | grep -E 'state|pid'
  mesh status
  sudo kill -9 <pid>                    # launchd restarts it (KeepAlive)
  tail -f /var/log/mesh-agent.log
  sudo mesh-agent uninstall
  ```
