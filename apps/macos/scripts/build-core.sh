#!/usr/bin/env bash
# Builds the Go core as a universal static library the Network Extension links:
# build/libmeshguard.a and build/libmeshguard.h. Run by Xcode before compiling.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p build
export CGO_ENABLED=1 MACOSX_DEPLOYMENT_TARGET=14.0
for arch in arm64 amd64; do
  clang_arch=$([ "$arch" = amd64 ] && echo x86_64 || echo arm64)
  CC="clang -arch $clang_arch" GOOS=darwin GOARCH=$arch \
    go build -C core -buildmode=c-archive -trimpath -o "../build/libmeshguard-$arch.a" .
done
lipo -create build/libmeshguard-arm64.a build/libmeshguard-amd64.a -output build/libmeshguard.a
mv build/libmeshguard-arm64.h build/libmeshguard.h
rm -f build/libmeshguard-*.a build/libmeshguard-*.h
