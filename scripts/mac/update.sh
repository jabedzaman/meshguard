#!/usr/bin/env bash
# Run on the Mac. Copies the binaries that scripts/build-mac.sh built on the
# dev machine into ~/Downloads/meshguard, then reinstalls the launchd service with
# the flags it already has. Reaches the dev machine over the mesh.
#
#   MESHGUARD_BUILD_HOST  ssh target (default: jabed@<mesh IP of thinkpad>)
#   MESHGUARD_BUILD_DIR   repo dist/mac on that host
#   --no-fetch            install what's already in ~/Downloads/meshguard
set -euo pipefail

dest="$HOME/Downloads/meshguard"
plist=/Library/LaunchDaemons/dev.jabed.meshguard.agent.plist
build_dir=${MESHGUARD_BUILD_DIR:-/home/jabed/developer/personal/twinlabs/mesh/dist/mac}

if [ "${1:-}" != --no-fetch ]; then
  host=${MESHGUARD_BUILD_HOST:-}
  if [ -z "$host" ]; then
    # Before the rename the CLI was `mesh`.
    ip=$(meshguard ip thinkpad 2>/dev/null || mesh ip thinkpad 2>/dev/null) || { echo "can't find thinkpad on the mesh; set MESHGUARD_BUILD_HOST=user@host" >&2; exit 1; }
    host="jabed@$ip"
  fi
  echo "==> fetching from $host:$build_dir"
  mkdir -p "$dest"
  scp -q "$host:$build_dir/meshguard" "$host:$build_dir/meshguard-agent" \
    "$host:$build_dir/update.sh" "$host:$build_dir/uninstall.sh" "$dest/"
fi
chmod +x "$dest"/meshguard "$dest"/meshguard-agent "$dest"/*.sh
xattr -d com.apple.quarantine "$dest"/meshguard "$dest"/meshguard-agent 2>/dev/null || true

# One-time move from the pre-rename "mesh" install: keep its flags and state
# (keys and enrollment), then remove the old service and binaries.
legacy_plist=/Library/LaunchDaemons/dev.twinlabs.mesh.agent.plist
if [ -f "$legacy_plist" ] && [ ! -f "$plist" ]; then
  echo "==> migrating the old mesh-agent install"
  legacy_copy=$(mktemp)
  cp "$legacy_plist" "$legacy_copy"
  if [ -x /usr/local/bin/mesh-agent ]; then
    sudo /usr/local/bin/mesh-agent uninstall
  else
    sudo launchctl bootout system/dev.twinlabs.mesh.agent 2>/dev/null || true
    sudo rm -f "$legacy_plist"
  fi
  if [ -d "/Library/Application Support/Mesh" ] && [ ! -e "/Library/Application Support/MeshGuard" ]; then
    sudo mv "/Library/Application Support/Mesh" "/Library/Application Support/MeshGuard"
  fi
  if head -1 /etc/resolver/internal 2>/dev/null | grep -q "Managed by mesh-agent"; then
    sudo rm -f /etc/resolver/internal
  fi
  sudo rm -rf /usr/local/bin/mesh /usr/local/bin/mesh-agent /var/log/mesh-agent.log /var/run/mesh
fi
from_plist=${legacy_copy:-$plist}

# Keep the service's flags (minus the binary and -socket-owner, which install
# sets to whoever runs sudo).
args=()
if [ -f "$from_plist" ]; then
  i=1
  while value=$(plutil -extract "ProgramArguments.$i" raw -o - "$from_plist" 2>/dev/null); do
    if [ "$value" = -socket-owner ]; then i=$((i + 2)); continue; fi
    [ "$value" = "/Library/Application Support/Mesh" ] && value="/Library/Application Support/MeshGuard"
    args+=("$value")
    i=$((i + 1))
  done
fi

echo "==> sudo meshguard-agent install ${args[*]:-}"
sudo "$dest/meshguard-agent" install ${args[@]+"${args[@]}"}
[ -n "${legacy_copy:-}" ] && rm -f "$legacy_copy"

cli=/usr/local/bin/meshguard
if [ "$(command -v meshguard)" != "$cli" ]; then
  echo "! $(command -v meshguard) comes before $cli on PATH; remove it to use the new CLI"
fi
for _ in $(seq 20); do "$cli" status >/dev/null 2>&1 && break; sleep 0.5; done
"$cli" version
"$cli" status
