#!/usr/bin/env bash
# Builds the macOS binaries into dist/mac/ for scripts/mac/update.sh to fetch.
# Usage: scripts/build-mac.sh [arm64|amd64]   (default arm64, Apple silicon)
set -euo pipefail
cd "$(dirname "$0")/.."

out=$(scripts/build-agent.sh darwin "${1:-arm64}" | tail -1 | cut -d' ' -f1)
rm -rf dist/mac && mkdir -p dist/mac
cp "$out/meshguard" "$out/meshguard-agent" scripts/mac/update.sh scripts/mac/uninstall.sh dist/mac/
echo "Built dist/mac. On the Mac: ~/Downloads/meshguard/update.sh"
