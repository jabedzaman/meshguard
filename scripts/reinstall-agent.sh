#!/usr/bin/env bash
# Rebuilds meshguard-agent and meshguard and reinstalls the systemd service on this Linux
# machine (WSL included), keeping the flags the service was installed with.
# Usage: scripts/reinstall-agent.sh
set -euo pipefail
cd "$(dirname "$0")/.."

out=$(scripts/build-agent.sh linux | tail -1 | cut -d' ' -f1)

# Flags from the current unit, minus the binary and -socket-owner (install
# sets that to whoever runs sudo).
args=()
unit=/etc/systemd/system/meshguard-agent.service
# Before the rename the service was mesh-agent; take its flags the first time.
legacy_unit=/etc/systemd/system/mesh-agent.service
[ ! -f "$unit" ] && [ -f "$legacy_unit" ] && unit=$legacy_unit
if [ -f "$unit" ]; then
  read -ra current <<<"$(sed -n 's/^ExecStart=//p' "$unit")"
  for ((i = 1; i < ${#current[@]}; i++)); do
    if [ "${current[$i]}" = -socket-owner ]; then i=$((i + 1)); continue; fi
    args+=("${current[$i]}")
  done
fi

# One-time move from the "mesh" install: keep its state (keys and enrollment),
# remove the old service and binaries.
if [ "$unit" = "$legacy_unit" ]; then
  echo "==> migrating the old mesh-agent install"
  sudo /usr/local/bin/mesh-agent uninstall || { sudo systemctl disable --now mesh-agent; sudo rm -f "$legacy_unit"; }
  if [ -d /var/lib/mesh ] && [ ! -e /var/lib/meshguard ]; then sudo mv /var/lib/mesh /var/lib/meshguard; fi
  sudo rm -rf /usr/local/bin/mesh /usr/local/bin/mesh-agent /var/run/mesh
  args=("${args[@]/#\/var\/lib\/mesh/\/var\/lib\/meshguard}")
fi

echo "==> sudo meshguard-agent install ${args[*]}"
sudo "$out/meshguard-agent" install "${args[@]}"

cli=/usr/local/bin/meshguard
if [ "$(command -v meshguard)" != "$cli" ]; then
  echo "! $(command -v meshguard) comes before $cli on PATH; remove it to use the new CLI"
fi
for _ in $(seq 20); do "$cli" status >/dev/null 2>&1 && break; sleep 0.5; done
"$cli" version
"$cli" status
