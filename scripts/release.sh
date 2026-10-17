#!/usr/bin/env bash
# Builds release tarballs and checksums into dist/release/ for scripts/install.sh.
# Usage: scripts/release.sh [target ...]   (targets as os/arch; default: linux/amd64 linux/arm64 darwin/arm64 darwin/amd64)
# MESHGUARD_SERVER=https://api.example.com bakes in the CLI's default --server.
# Upload the contents of dist/release/ to a GitHub release (or any static host).
set -euo pipefail
cd "$(dirname "$0")/.."

targets=("$@")
[ ${#targets[@]} -gt 0 ] || targets=(linux/amd64 linux/arm64 darwin/arm64 darwin/amd64)
out=dist/release
tar_flags=""
# bsdtar (macOS) would store extended attributes that GNU tar warns about
tar --version 2>/dev/null | grep -q bsdtar && tar_flags="--no-xattrs"
rm -rf "$out"
mkdir -p "$out"

for target in "${targets[@]}"; do
  goos=${target%/*}
  goarch=${target#*/}
  scripts/build-agent.sh "$goos" "$goarch" >/dev/null
  COPYFILE_DISABLE=1 tar $tar_flags -C "dist/$goos-$goarch" -czf "$out/meshguard_${goos}_${goarch}.tar.gz" meshguard-agent meshguard
  echo "  $out/meshguard_${goos}_${goarch}.tar.gz"
done

cp scripts/install.sh "$out/install.sh"
(cd "$out" && { sha256sum ./*.tar.gz 2>/dev/null || shasum -a 256 ./*.tar.gz; } | sed 's# \./# #' >SHA256SUMS)
echo "$out ($(git describe --always --dirty))"
