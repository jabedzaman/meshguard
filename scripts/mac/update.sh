#!/usr/bin/env bash
# Run on the Mac. Copies the binaries that scripts/build-mac.sh built on the
# dev machine into ~/Downloads/mesh, then reinstalls the launchd service with
# the flags it already has. Reaches the dev machine over the mesh.
#
#   MESH_BUILD_HOST  ssh target (default: jabed@<mesh IP of thinkpad>)
#   MESH_BUILD_DIR   repo dist/mac on that host
#   --no-fetch       install what's already in ~/Downloads/mesh
set -euo pipefail

dest="$HOME/Downloads/mesh"
plist=/Library/LaunchDaemons/dev.twinlabs.mesh.agent.plist
build_dir=${MESH_BUILD_DIR:-/home/jabed/developer/personal/twinlabs/mesh/dist/mac}

if [ "${1:-}" != --no-fetch ]; then
  host=${MESH_BUILD_HOST:-}
  if [ -z "$host" ]; then
    ip=$(mesh ip thinkpad 2>/dev/null) || { echo "can't find thinkpad on the mesh; set MESH_BUILD_HOST=user@host" >&2; exit 1; }
    host="jabed@$ip"
  fi
  echo "==> fetching from $host:$build_dir"
  mkdir -p "$dest"
  scp -q "$host:$build_dir/mesh" "$host:$build_dir/mesh-agent" \
    "$host:$build_dir/update.sh" "$host:$build_dir/uninstall.sh" "$dest/"
fi
chmod +x "$dest"/mesh "$dest"/mesh-agent "$dest"/*.sh
xattr -d com.apple.quarantine "$dest"/mesh "$dest"/mesh-agent 2>/dev/null || true

# Keep the service's flags (minus the binary and -socket-owner, which install
# sets to whoever runs sudo).
args=()
if [ -f "$plist" ]; then
  i=1
  while value=$(plutil -extract "ProgramArguments.$i" raw -o - "$plist" 2>/dev/null); do
    if [ "$value" = -socket-owner ]; then i=$((i + 2)); continue; fi
    args+=("$value")
    i=$((i + 1))
  done
fi

echo "==> sudo mesh-agent install ${args[*]:-}"
sudo "$dest/mesh-agent" install ${args[@]+"${args[@]}"}

mesh=/usr/local/bin/mesh
if [ "$(command -v mesh)" != "$mesh" ]; then
  echo "! $(command -v mesh) comes before $mesh on PATH; remove it to use the new CLI"
fi
for _ in $(seq 20); do "$mesh" status >/dev/null 2>&1 && break; sleep 0.5; done
"$mesh" version
"$mesh" status
