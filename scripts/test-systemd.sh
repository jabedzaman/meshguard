#!/usr/bin/env bash
# Tests `mesh-agent install` against real systemd: a Debian container running
# systemd as PID 1. Checks the unit is enabled and running, a normal user can
# use mesh without sudo, systemd restarts a killed agent, and uninstall cleans up.
# Usage: pnpm test:systemd
set -euo pipefail

NAME=mesh-systemd-test
BIN=$(mktemp -d)
trap 'docker rm -f "$NAME" >/dev/null 2>&1; rm -rf "$BIN"' EXIT

echo "==> building linux binaries"
(cd apps/agent && CGO_ENABLED=0 go build -o "$BIN/mesh-agent" ./cmd/mesh-agent)
(cd apps/cli && CGO_ENABLED=0 go build -o "$BIN/mesh" ./cmd/mesh)

echo "==> starting a systemd container"
docker build -q -t mesh-systemd-test - >/dev/null <<'DOCKERFILE'
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends systemd systemd-sysv iproute2 \
    && rm -rf /var/lib/apt/lists/* \
    && useradd -m -u 1000 dev
STOPSIGNAL SIGRTMIN+3
CMD ["/lib/systemd/systemd"]
DOCKERFILE
docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d --name "$NAME" --privileged --cgroupns=host \
  -v /sys/fs/cgroup:/sys/fs/cgroup:rw --tmpfs /run --tmpfs /run/lock \
  -v "$BIN:/opt/mesh:ro" mesh-systemd-test >/dev/null
for _ in $(seq 30); do
  state=$(docker exec "$NAME" systemctl is-system-running 2>/dev/null || true)
  case "$state" in running|degraded) break ;; esac
  sleep 1
done
echo "  systemd is $state"

ctr() { docker exec "$NAME" sh -c "$1"; }
status=0
check() { if ctr "$2" >/dev/null 2>&1; then echo "  ok    $1"; else echo "  FAIL  $1"; status=1; fi; }

echo "==> sudo mesh-agent install (as user dev)"
ctr 'cd /opt/mesh && SUDO_UID=1000 SUDO_GID=1000 ./mesh-agent install'
sleep 2
check "unit is enabled (starts at boot)" 'systemctl is-enabled mesh-agent'
check "agent is running"                 'systemctl is-active mesh-agent'
check "binaries in /usr/local/bin"       'test -x /usr/local/bin/mesh-agent && test -x /usr/local/bin/mesh'
check "socket owned by the sudo user"    'test "$(stat -c %u /var/run/mesh/agent.sock)" = 1000'
check "mesh status works without sudo"   'su dev -c "mesh status" | grep -q "Not in a network"'

echo "==> kill -9 the agent"
pid=$(ctr 'systemctl show -p MainPID --value mesh-agent')
ctr "kill -9 $pid"
for _ in $(seq 15); do
  new=$(ctr 'systemctl show -p MainPID --value mesh-agent')
  [ "$new" != "0" ] && [ "$new" != "$pid" ] && break
  sleep 1
done
check "systemd restarted it (pid $pid -> $new)" "test '$new' != 0 && test '$new' != '$pid' && systemctl is-active mesh-agent"

echo "==> sudo mesh-agent uninstall"
ctr '/usr/local/bin/mesh-agent uninstall'
check "unit removed"      'test ! -e /etc/systemd/system/mesh-agent.service'
check "agent stopped"     '! systemctl is-active mesh-agent'

echo
echo "journal:"
ctr 'journalctl -u mesh-agent --no-pager -o cat | tail -5' || true
exit $status
