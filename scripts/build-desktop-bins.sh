#!/usr/bin/env bash
# Builds meshguard-agent and meshguard into apps/desktop/src-tauri/bin/ so the
# desktop app bundles them (the app installs both as the service and the CLI).
# Usage: scripts/build-desktop-bins.sh [goos] [goarch]   (default: this machine)
set -euo pipefail
cd "$(dirname "$0")/.."

out=$(scripts/build-agent.sh "$@" | tail -1 | cut -d' ' -f1)
dest=apps/desktop/src-tauri/bin
mkdir -p "$dest"
cp "$out/meshguard" "$out/meshguard-agent" "$dest/"
echo "Bundled $out into $dest"
