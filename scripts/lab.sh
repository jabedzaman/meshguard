#!/usr/bin/env bash
# Mesh lab on the e2e stack:
#   lab-a ↔ lab-b share a Docker network  → must connect directly
#   lab-c ↔ lab-d are on isolated networks → must connect through the relay
# Usage: pnpm e2e:up && pnpm lab
set -euo pipefail

API=${E2E_API_URL:-http://localhost:4200}
WEB=${E2E_WEB_URL:-http://localhost:3200}
INTERNAL_API=http://api-e2e:4000   # how the lab containers reach the API
COOKIES=$(mktemp)
trap 'rm -f "$COOKIES"' EXIT

json() { node -pe "JSON.parse(require('fs').readFileSync(0, 'utf8'))$1"; }
post() { curl -sf -m 15 -b "$COOKIES" -c "$COOKIES" -H "Origin: $WEB" -H 'Content-Type: application/json' -d "$2" "$API$1"; }
ip_of() { docker exec "mesh-$1" mesh status | awk -v f="$2" '$1=="mesh" && $2==f {print $3; exit}'; }

echo "==> migrating the e2e database"
DATABASE_URL=${E2E_DATABASE_URL:-postgres://mesh:mesh@localhost:5432/mesh_test} \
  pnpm --silent --filter @mesh/db db:migrate >/dev/null

echo "==> starting relay (api-e2e restarts to join the lab networks)"
docker compose up -d --build relay >/dev/null
docker compose --profile e2e up -d api-e2e >/dev/null
for _ in $(seq 60); do curl -sf "$API/healthz" >/dev/null && break; sleep 1; done
docker compose --profile lab up -d --build --force-recreate lab-a lab-b lab-c lab-d >/dev/null

echo "==> creating a network on $API"
id="lab-$(date +%s)"
post /api/auth/sign-up/email "{\"name\":\"Lab\",\"email\":\"$id@e2e.test\",\"password\":\"correct-horse-battery\"}" >/dev/null
post /api/auth/organization/create "{\"name\":\"Lab $id\",\"slug\":\"$id\"}" >/dev/null

status=0
check_ping() {
  if docker exec "mesh-$1" ping -c 3 -W 2 "$2" >/dev/null 2>&1; then
    echo "  ok    $1 -> $2"
  else
    echo "  FAIL  $1 -> $2"; status=1
  fi
}

# run_pair <network name> <a> <b> <expected path: direct|relay>
run_pair() {
  local name=$1 a=$2 b=$3 want=$4
  echo
  echo "==> $a <-> $b (expect $want)"
  local network
  network=$(post /v1/networks "{\"name\":\"$name\"}" | json .id)
  for device in "$a" "$b"; do
    local token
    token=$(post "/v1/networks/$network/enrollment-tokens" '{}' | json .token)
    docker exec "mesh-$device" mesh up --token "$token" --server "$INTERNAL_API" | head -1
  done

  local a4 b4 b6
  a4=$(ip_of "$a" IPv4); b4=$(ip_of "$b" IPv4); b6=$(ip_of "$b" IPv6)
  for _ in $(seq 40); do
    docker exec "mesh-$a" ping -c 1 -W 1 "$b4" >/dev/null 2>&1 && break
    sleep 1
  done
  check_ping "$a" "$b4"
  check_ping "$b" "$a4"
  check_ping "$a" "$b6"

  local path
  if docker exec "mesh-$a" mesh status | grep -q "via relay"; then path=relay; else path=direct; fi
  if [ "$path" = "$want" ]; then echo "  ok    path is $path"; else echo "  FAIL  path is $path, want $want"; status=1; fi
}

run_pair lab-direct lab-a lab-b direct

# Sanity: the isolated pair really can't reach each other outside the mesh.
d_eth=$(docker inspect mesh-lab-d --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}')
if docker exec mesh-lab-c ping -c 1 -W 1 "$d_eth" >/dev/null 2>&1; then
  echo "  FAIL  lab-c can reach lab-d directly ($d_eth); the relay test would be meaningless"; status=1
else
  echo
  echo "  ok    lab-c cannot reach lab-d's container address $d_eth directly"
fi
run_pair lab-relay lab-c lab-d relay

echo
docker exec mesh-lab-c mesh status
exit $status
