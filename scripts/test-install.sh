#!/usr/bin/env bash
# Tests scripts/release.sh + scripts/install.sh in a Debian container running systemd:
# the script installs from the tarball, the agent runs, a tampered tarball is refused.
# Usage: pnpm test:install
set -euo pipefail
cd "$(dirname "$0")/.."

NAME=meshguard-install-test
trap 'docker rm -f "$NAME" >/dev/null 2>&1' EXIT

case "$(uname -m)" in x86_64|amd64) arch=amd64 ;; *) arch=arm64 ;; esac
echo "==> building linux/$arch release"
scripts/release.sh "linux/$arch" >/dev/null

echo "==> starting a systemd container"
docker build -q -t meshguard-install-test - >/dev/null <<'DOCKERFILE'
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends systemd systemd-sysv iproute2 curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
STOPSIGNAL SIGRTMIN+3
CMD ["/lib/systemd/systemd"]
DOCKERFILE
docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d --name "$NAME" --privileged --cgroupns=host \
  -v /sys/fs/cgroup:/sys/fs/cgroup:rw --tmpfs /run --tmpfs /run/lock \
  -v "$PWD/dist/release:/release:ro" meshguard-install-test >/dev/null
for _ in $(seq 30); do
  state=$(docker exec "$NAME" systemctl is-system-running 2>/dev/null || true)
  case "$state" in running|degraded) break ;; esac
  sleep 1
done
echo "  systemd is $state"

ctr() { docker exec "$NAME" sh -c "$1"; }
status=0
check() { if ctr "$2" >/dev/null 2>&1; then echo "  ok    $1"; else echo "  FAIL  $1"; status=1; fi; }

echo "==> install.sh from the release folder"
ctr 'MESHGUARD_BASE_URL=file:///release sh /release/install.sh'
sleep 2
check "agent is running"            'systemctl is-active meshguard-agent'
check "unit is enabled"             'systemctl is-enabled meshguard-agent'
check "binaries in /usr/local/bin"  'test -x /usr/local/bin/meshguard-agent && test -x /usr/local/bin/meshguard'
check "meshguard status works"      'meshguard status | grep -q "Not in a network"'

echo "==> tampered tarball"
ctr 'mkdir -p /bad && cp /release/* /bad/ && echo x >> /bad/meshguard_linux_'"$arch"'.tar.gz'
if ctr 'MESHGUARD_BASE_URL=file:///bad sh /bad/install.sh' >/dev/null 2>&1; then
  echo "  FAIL  checksum mismatch refused"; status=1
else
  echo "  ok    checksum mismatch refused"
fi

exit $status
