#!/usr/bin/env bash
# Builds meshguard-agent and meshguard into dist/<os>-<arch>/, stamped with the git version.
# Usage: scripts/build-agent.sh [goos] [goarch]   (default: this machine)
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
(cd apps/cli && go build -ldflags "-X github.com/jabedzaman/meshguard/apps/cli/internal/cli.Version=$version" -o "$out/meshguard" ./cmd/meshguard)
echo "$out ($version)"
