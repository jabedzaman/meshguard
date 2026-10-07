#!/usr/bin/env bash
# Run on the Mac. Stops and removes the meshguard-agent launchd service.
#
#   (no flags)  remove the service; keep binaries, keys and enrollment
#   --purge     also leave the network (meshguard logout), and delete the binaries,
#               state, log and the /etc/resolver files it wrote
set -euo pipefail

purge=""
[ "${1:-}" = --purge ] && purge=1

if [ -n "$purge" ] && command -v meshguard >/dev/null; then
  echo "==> meshguard logout"
  meshguard logout || echo "   couldn't leave the network; remove this device from the web if needed"
fi

echo "==> removing the service"
if [ -x /usr/local/bin/meshguard-agent ]; then
  sudo /usr/local/bin/meshguard-agent uninstall
else
  sudo launchctl bootout system/dev.jabed.meshguard.agent 2>/dev/null || true
  sudo rm -f /Library/LaunchDaemons/dev.jabed.meshguard.agent.plist
fi

if [ -n "$purge" ]; then
  echo "==> deleting binaries, state and logs"
  sudo rm -f /usr/local/bin/meshguard /usr/local/bin/meshguard-agent /var/log/meshguard-agent.log
  sudo rm -rf "/Library/Application Support/MeshGuard" /var/run/meshguard
  for f in /etc/resolver/*; do
    if head -1 "$f" 2>/dev/null | grep -q "Managed by meshguard-agent"; then sudo rm -f "$f"; fi
  done
  echo "Done. A state dir passed with -state-dir (e.g. ~/.meshguard) was left alone."
else
  echo "Done. Binaries and state kept; reinstall with ~/Downloads/meshguard/update.sh --no-fetch"
fi
