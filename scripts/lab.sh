#!/usr/bin/env bash
# Mesh lab on the e2e stack (see the lab section in docker-compose.override.yaml):
#   lab-a ↔ lab-b  share a LAN                    → direct
#   lab-e ↔ lab-f  e behind a cone NAT, f public  → direct through e's NAT
#   lab-g ↔ lab-h  g symmetric NAT, h cone NAT    → relay
# Usage: pnpm e2e:up && pnpm lab
set -euo pipefail

API=${E2E_API_URL:-http://localhost:4200}
WEB=${E2E_WEB_URL:-http://localhost:3200}
LAB_API=http://10.200.0.10:4000   # api-e2e on the lab "internet"
COOKIES=$(mktemp)
trap 'rm -f "$COOKIES"' EXIT

json() { node -pe "JSON.parse(require('fs').readFileSync(0, 'utf8'))$1"; }
post() { curl -sf -m 15 -b "$COOKIES" -c "$COOKIES" -H "Origin: $WEB" -H 'Content-Type: application/json' -d "$2" "$API$1"; }
ip_of() { docker exec "mesh-$1" mesh status | awk -v f="$2" '$1=="mesh" && $2==f {print $3; exit}'; }
# "direct" or "relay", from the first peer line of mesh status.
peer_path() { docker exec "mesh-$1" mesh status | awk '/^peers:/ {p=1; next} p && NF {print ($3 == "via" ? "relay" : $3); exit}'; }
peer_line() { docker exec "mesh-$1" mesh status | awk '/^peers:/ {p=1; next} p && NF {print; exit}'; }

echo "==> migrating the e2e database"
DATABASE_URL=${E2E_DATABASE_URL:-postgres://mesh:mesh@localhost:5432/mesh_test} \
  pnpm --silent --filter @mesh/db db:migrate >/dev/null

echo "==> starting relay, api-e2e and the lab"
docker rm -f mesh-lab-c mesh-lab-d >/dev/null 2>&1 || true   # from the previous lab layout
docker compose up -d --build relay >/dev/null
docker compose --profile e2e up -d api-e2e >/dev/null
for _ in $(seq 60); do curl -sf "$API/healthz" >/dev/null && break; sleep 1; done
docker compose --profile lab up -d --build --force-recreate \
  router-e router-g router-h lab-a lab-b lab-e lab-f lab-g lab-h >/dev/null

echo "==> creating an organization on $API"
id="lab-$(date +%s)"
post /api/auth/sign-up/email "{\"name\":\"Lab\",\"email\":\"$id@e2e.test\",\"password\":\"correct-horse-battery\"}" >/dev/null
post /api/auth/organization/create "{\"name\":\"Lab $id\",\"slug\":\"$id\"}" >/dev/null

status=0
ok() { echo "  ok    $*"; }
fail() { echo "  FAIL  $*"; status=1; }
check_ping() {
  if docker exec "mesh-$1" ping -c 3 -W 2 "$2" >/dev/null 2>&1; then ok "$1 -> $2"; else fail "$1 -> $2"; fi
}

# run_pair <network> <a> <b> <direct|relay>
run_pair() {
  local name=$1 a=$2 b=$3 want=$4
  echo
  echo "==> $a <-> $b (expect $want)"
  local network
  network=$(post /v1/networks "{\"name\":\"$name\"}" | json .id)
  for device in "$a" "$b"; do
    local token
    token=$(post "/v1/networks/$network/enrollment-tokens" '{}' | json .token)
    docker exec "mesh-$device" mesh up --token "$token" --server "$LAB_API" | head -1
  done

  # Hole punching takes a few sync rounds (STUN, advertise, probe, switch).
  local path=""
  for _ in $(seq 60); do
    path=$(peer_path "$a")
    [ "$path" = "$want" ] && break
    sleep 1
  done

  local a4 b4 b6
  a4=$(ip_of "$a" IPv4); b4=$(ip_of "$b" IPv4); b6=$(ip_of "$b" IPv6)
  check_ping "$a" "$b4"
  check_ping "$b" "$a4"
  check_ping "$a" "$b6"
  if [ "$path" = "$want" ]; then ok "path: $(peer_line "$a" | awk '{$1=$1; print}')"; else fail "path is ${path:-unknown}, want $want: $(peer_line "$a")"; fi
}

run_pair lab-lan lab-a lab-b direct

# Sanity: lab-f can't open a connection into lab-e's NAT on its own.
if docker exec mesh-lab-f ping -c 1 -W 1 10.201.0.10 >/dev/null 2>&1; then
  fail "lab-f reaches lab-e's LAN address; the NAT test would be meaningless"
else
  echo; ok "lab-f cannot reach lab-e's LAN address 10.201.0.10 outside the mesh"
fi
run_pair lab-nat lab-e lab-f direct
run_pair lab-symmetric lab-g lab-h relay

echo
docker exec mesh-lab-e mesh status
exit $status
