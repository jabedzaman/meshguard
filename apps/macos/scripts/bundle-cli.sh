#!/usr/bin/env bash
# Builds the Go CLI (universal) into the app at Contents/Helpers/meshguard and
# signs it with the app's identity, so one .dmg carries app, agent and CLI.
set -euo pipefail
repo="$(cd "$(dirname "$0")/../../.." && pwd)"
dest="$TARGET_BUILD_DIR/$CONTENTS_FOLDER_PATH/Helpers"
mkdir -p "$dest" "$SRCROOT/build"
export CGO_ENABLED=0
for arch in arm64 amd64; do
  GOOS=darwin GOARCH=$arch go build -C "$repo/apps/cli" -trimpath \
    -ldflags "-s -w -X main.version=${MARKETING_VERSION:-dev}" \
    -o "$SRCROOT/build/meshguard-$arch" ./cmd/meshguard
done
lipo -create "$SRCROOT/build/meshguard-arm64" "$SRCROOT/build/meshguard-amd64" -output "$dest/meshguard"
rm -f "$SRCROOT/build/meshguard-arm64" "$SRCROOT/build/meshguard-amd64"
if [ -n "${EXPANDED_CODE_SIGN_IDENTITY:-}" ] && [ "${CODE_SIGNING_ALLOWED:-YES}" = YES ]; then
  codesign --force --options runtime --sign "$EXPANDED_CODE_SIGN_IDENTITY" "$dest/meshguard"
fi
