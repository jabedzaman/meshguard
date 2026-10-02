#!/usr/bin/env bash
# Two-device lab: enrolls two containerized agents into a fresh network on the
# e2e stack and checks they can ping each other over the mesh.
# Usage: pnpm e2e:up && pnpm lab
set -euo pipefail

API=${E2E_API_URL:-http://localhost:4200}
WEB=${E2E_WEB_URL:-http://localhost:3200}
INTERNAL_API=http://api-e2e:4000   # how the lab containers reach the API
COOKIES=$(mktemp)
trap 'rm -f "$COOKIES"' EXIT

json() { node -pe "JSON.parse(require('fs').readFileSync(0, 'utf8'))$1"; }
post() { curl -sf -m 15 -b "$COOKIES" -c "$COOKIES" -H "Origin: $WEB" -H 'Content-Type: application/json' -d "$2" "$API$1"; }

echo "==> migrating the e2e database"
DATABASE_URL=${E2E_DATABASE_URL:-postgres://mesh:mesh@localhost:5432/mesh_test} \
  pnpm --silent --filter @mesh/db db:migrate >/dev/null

echo "==> starting lab devices"
docker compose --profile lab up -d --build --force-recreate lab-a lab-b >/dev/null

echo "==> creating a network on $API"
id="lab-$(date +%s)"
post /api/auth/sign-up/email "{\"name\":\"Lab\",\"email\":\"$id@e2e.test\",\"password\":\"correct-horse-battery\"}" >/dev/null
post /api/auth/organization/create "{\"name\":\"Lab $id\",\"slug\":\"$id\"}" >/dev/null
network=$(post /v1/networks '{"name":"lab"}' | json .id)

for device in lab-a lab-b; do
  token=$(post "/v1/networks/$network/enrollment-tokens" '{}' | json .token)
  echo "==> $device: mesh up"
  docker exec "mesh-$device" mesh up --token "$token" --server "$INTERNAL_API"
done

ip_of() { docker exec "mesh-$1" mesh status | awk -v f="$2" '$1=="mesh" && $2==f {print $3; exit}'; }
b4=$(ip_of lab-b IPv4); b6=$(ip_of lab-b IPv6); a4=$(ip_of lab-a IPv4)

echo "==> waiting for peers to sync and ping"
for _ in $(seq 30); do
  if docker exec mesh-lab-a ping -c 1 -W 1 "$b4" >/dev/null 2>&1; then break; fi
  sleep 1
done

status=0
check() {
  if docker exec "mesh-$1" ping -c 3 -W 2 "$2" >/dev/null 2>&1; then
    echo "  ok    $1 -> $2"
  else
    echo "  FAIL  $1 -> $2"; status=1
  fi
}
check lab-a "$b4"
check lab-b "$a4"
check lab-a "$b6"

echo
docker exec mesh-lab-a mesh status
exit $status
