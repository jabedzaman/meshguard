#!/usr/bin/env bash
# Builds meshguard-agent and meshguard into dist/<os>-<arch>/, stamped with the git version.
# Usage: scripts/build-agent.sh [goos] [goarch]   (default: this machine)
# MESHGUARD_SERVER=https://api.example.com bakes in the CLI's default --server.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.local/share/go/bin:$PATH"

goos=${1:-$(go env GOOS)}
goarch=${2:-$(go env GOARCH)}
out="$PWD/dist/$goos-$goarch"
version=$(git describe --always --dirty)
mkdir -p "$out"

export GOOS=$goos GOARCH=$goarch CGO_ENABLED=0
(cd apps/agent && go build -ldflags "-X main.version=$version" -o "$out/meshguard-agent" ./cmd/meshguard-agent)
cli_pkg=github.com/jabedzaman/meshguard/apps/cli/internal/cli
cli_flags="-X $cli_pkg.Version=$version"
if [ -n "${MESHGUARD_SERVER:-}" ]; then
  cli_flags="$cli_flags -X $cli_pkg.DefaultServer=$MESHGUARD_SERVER"
fi
(cd apps/cli && go build -ldflags "$cli_flags" -o "$out/meshguard" ./cmd/meshguard)
echo "$out ($version)"
