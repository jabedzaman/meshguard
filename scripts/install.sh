#!/bin/sh
# Installs meshguard-agent and meshguard and registers the agent as a service.
#   curl -fsSL https://github.com/jabedzaman/meshguard/releases/latest/download/install.sh | sudo sh
# MESHGUARD_BASE_URL  where the tarballs and SHA256SUMS live (default: the latest GitHub release;
#                     file:///path works for a local dist/release)
set -eu

base=${MESHGUARD_BASE_URL:-https://github.com/jabedzaman/meshguard/releases/latest/download}

[ "$(id -u)" -eq 0 ] || { echo "run as root: curl -fsSL .../install.sh | sudo sh" >&2; exit 1; }

case "$(uname -s)" in
  Linux) os=linux ;;
  Darwin) os=darwin ;;
  *) echo "unsupported OS: $(uname -s)" >&2; exit 1 ;;
esac
case "$(uname -m)" in
  x86_64|amd64) arch=amd64 ;;
  aarch64|arm64) arch=arm64 ;;
  *) echo "unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac

tarball="meshguard_${os}_${arch}.tar.gz"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

echo "==> downloading $tarball"
curl -fsSL "$base/$tarball" -o "$tmp/$tarball"
curl -fsSL "$base/SHA256SUMS" -o "$tmp/SHA256SUMS"

echo "==> verifying checksum"
want=$(grep " $tarball\$" "$tmp/SHA256SUMS" | cut -d' ' -f1)
[ -n "$want" ] || { echo "no checksum for $tarball" >&2; exit 1; }
if command -v sha256sum >/dev/null 2>&1; then
  got=$(sha256sum "$tmp/$tarball" | cut -d' ' -f1)
else
  got=$(shasum -a 256 "$tmp/$tarball" | cut -d' ' -f1)
fi
[ "$want" = "$got" ] || { echo "checksum mismatch for $tarball" >&2; exit 1; }

tar -xzf "$tmp/$tarball" -C "$tmp"
echo "==> installing"
"$tmp/meshguard-agent" install

echo
echo "Installed. Join a network with: meshguard up"
