#!/usr/bin/env bash
# Rebuilds meshguard-agent and meshguard and reinstalls the launchd service on this Mac,
# keeping the flags the service was installed with.
# Usage: scripts/install-mac.sh
# MESHGUARD_SERVER=https://api.example.com bakes in the CLI's default --server.
set -euo pipefail
cd "$(dirname "$0")/.."

[ "$(uname)" = Darwin ] || { echo "this script is for macOS; on Linux use scripts/reinstall-agent.sh" >&2; exit 1; }

out=$(scripts/build-agent.sh | tail -1 | cut -d' ' -f1)

# Flags from the current plist, minus the binary and -socket-owner (install
# sets that to whoever runs sudo).
args=()
plist=/Library/LaunchDaemons/dev.jabed.meshguard.agent.plist
if [ -f "$plist" ]; then
  current=()
  while IFS= read -r line; do current+=("$line"); done < <(
    /usr/libexec/PlistBuddy -c 'Print :ProgramArguments' "$plist" | sed -n 's/^    //p'
  )
  for ((i = 1; i < ${#current[@]}; i++)); do
    if [ "${current[$i]}" = -socket-owner ]; then i=$((i + 1)); continue; fi
    args+=("${current[$i]}")
  done
fi

echo "==> sudo meshguard-agent install ${args[*]-}"
sudo "$out/meshguard-agent" install ${args[@]+"${args[@]}"}

cli=/usr/local/bin/meshguard
if [ "$(command -v meshguard)" != "$cli" ]; then
  echo "! $(command -v meshguard) comes before $cli on PATH; remove it to use the new CLI"
fi
for _ in $(seq 20); do "$cli" status >/dev/null 2>&1 && break; sleep 0.5; done
"$cli" version
"$cli" status || true
echo
echo "Ready. To test browser login: meshguard logout (if enrolled), then meshguard login"
