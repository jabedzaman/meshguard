#!/usr/bin/env bash
# Rebuilds mesh-agent and mesh and reinstalls the systemd service on this Linux
# machine (WSL included), keeping the flags the service was installed with.
# Usage: scripts/reinstall-agent.sh
set -euo pipefail
cd "$(dirname "$0")/.."

out=$(scripts/build-agent.sh linux | tail -1 | cut -d' ' -f1)

# Flags from the current unit, minus the binary and -socket-owner (install
# sets that to whoever runs sudo).
args=()
unit=/etc/systemd/system/mesh-agent.service
if [ -f "$unit" ]; then
  read -ra current <<<"$(sed -n 's/^ExecStart=//p' "$unit")"
  for ((i = 1; i < ${#current[@]}; i++)); do
    if [ "${current[$i]}" = -socket-owner ]; then i=$((i + 1)); continue; fi
    args+=("${current[$i]}")
  done
fi

echo "==> sudo mesh-agent install ${args[*]}"
sudo "$out/mesh-agent" install "${args[@]}"

mesh=/usr/local/bin/mesh
if [ "$(command -v mesh)" != "$mesh" ]; then
  echo "! $(command -v mesh) comes before $mesh on PATH; remove it to use the new CLI"
fi
for _ in $(seq 20); do "$mesh" status >/dev/null 2>&1 && break; sleep 0.5; done
"$mesh" version
"$mesh" status
