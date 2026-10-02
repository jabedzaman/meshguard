#!/usr/bin/env bash
# Run on the Mac. Stops and removes the mesh-agent launchd service.
#
#   (no flags)  remove the service; keep binaries, keys and enrollment
#   --purge     also leave the network (mesh logout), and delete the binaries,
#               state, log and /etc/resolver/internal
set -euo pipefail

purge=""
[ "${1:-}" = --purge ] && purge=1

if [ -n "$purge" ] && command -v mesh >/dev/null; then
  echo "==> mesh logout"
  mesh logout || echo "   couldn't leave the network; remove this device from the web if needed"
fi

echo "==> removing the service"
if [ -x /usr/local/bin/mesh-agent ]; then
  sudo /usr/local/bin/mesh-agent uninstall
else
  sudo launchctl bootout system/dev.twinlabs.mesh.agent 2>/dev/null || true
  sudo rm -f /Library/LaunchDaemons/dev.twinlabs.mesh.agent.plist
fi

if [ -n "$purge" ]; then
  echo "==> deleting binaries, state and logs"
  sudo rm -f /usr/local/bin/mesh /usr/local/bin/mesh-agent /var/log/mesh-agent.log
  sudo rm -rf "/Library/Application Support/Mesh" /var/run/mesh
  if head -1 /etc/resolver/internal 2>/dev/null | grep -q "Managed by mesh-agent"; then
    sudo rm -f /etc/resolver/internal
  fi
  echo "Done. A state dir passed with -state-dir (e.g. ~/.mesh) was left alone."
else
  echo "Done. Binaries and state kept; reinstall with ~/Downloads/mesh/update.sh --no-fetch"
fi
