#!/usr/bin/env bash
# MeshGuard lab on the e2e stack (see the lab section in docker-compose.override.yaml):
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
patch() { curl -sf -m 15 -X PATCH -b "$COOKIES" -c "$COOKIES" -H "Origin: $WEB" -H 'Content-Type: application/json' -d "$2" "$API$1"; }
ip_of() { if [ "$2" = IPv6 ]; then docker exec "meshguard-$1" meshguard ip -6; else docker exec "meshguard-$1" meshguard ip; fi; }
# "direct" or "relay" for the first peer, from meshguard peers --json.
peer_path() {
  docker exec "meshguard-$1" meshguard peers --json | node -pe '
    const p = JSON.parse(require("fs").readFileSync(0, "utf8"))[0] || {};
    p.viaRelay ? "relay" : (p.endpoint ? "direct" : "")'
}
peer_line() { docker exec "meshguard-$1" meshguard peers | sed -n 2p; }
# The detail of one doctor check: doctor_detail <device> <check name> <doctor args...>
doctor_detail() {
  local device=$1 name=$2; shift 2
  docker exec "meshguard-$device" meshguard doctor --json "$@" | node -pe "
    (JSON.parse(require('fs').readFileSync(0, 'utf8')).findLast(c => c.name === '$name') || {}).detail"
}
dns_name() { docker exec "meshguard-$1" meshguard status --json | json .dns.name; }

echo "==> migrating the e2e database"
DATABASE_URL=${E2E_DATABASE_URL:-postgres://meshguard:meshguard@localhost:5432/meshguard_test} \
  pnpm --silent --filter @meshguard/db db:migrate >/dev/null

echo "==> starting relay, api-e2e and the lab"
docker rm -f meshguard-lab-c meshguard-lab-d >/dev/null 2>&1 || true   # from the previous lab layout
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
  if docker exec "meshguard-$1" ping -c 3 -W 2 "$2" >/dev/null 2>&1; then ok "$1 -> $2"; else fail "$1 -> $2"; fi
}
can_ping() { docker exec "meshguard-$1" ping -c 1 -W 1 "$2" >/dev/null 2>&1; }
can_connect() { docker exec "meshguard-$1" nc -z -w 2 "$2" "$3" >/dev/null 2>&1; }
# expect_traffic <allowed|blocked> <description> <command...>: polls ~25s, as agents
# pick up access rules on their next sync (every 10s).
expect_traffic() {
  local want=$1 what=$2 got; shift 2
  for _ in $(seq 25); do
    if "$@"; then got=allowed; else got=blocked; fi
    [ "$got" = "$want" ] && { ok "$what: $want"; return; }
    sleep 1
  done
  fail "$what: $got, want $want"
}

# run_pair <network> <a> <b> <direct|relay>
run_pair() {
  local name=$1 a=$2 b=$3 want=$4
  echo
  echo "==> $a <-> $b (expect $want)"
  local network
  network=$(post /v1/networks "{\"name\":\"$name\"}" | json .id)
  LAST_NETWORK=$network
  for device in "$a" "$b"; do
    local token
    token=$(post "/v1/networks/$network/enrollment-tokens" '{}' | json .token)
    docker exec "meshguard-$device" meshguard up --token "$token" --server "$LAB_API" | head -1
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
  # The lab has no systemd-resolved, so ask the agent's resolver directly.
  local b_name resolved
  b_name=$(dns_name "$b")
  resolved=$(docker exec "meshguard-$a" dig +short +time=2 +tries=1 @100.100.100.53 "$b_name" A)
  if [ "$resolved" = "$b4" ]; then ok "$a resolves $b_name -> $b4"; else fail "$a resolves $b_name to '${resolved}', want $b4"; fi
  resolved=$(docker exec "meshguard-$a" dig +short +time=2 +tries=1 @100.100.100.53 -x "$b4")
  if [ "$resolved" = "$b_name." ]; then ok "$a resolves $b4 -> $b_name"; else fail "$a resolves $b4 to '${resolved}', want $b_name."; fi
  if [ "$path" = "$want" ]; then ok "path: $(peer_line "$a" | awk '{$1=$1; print}')"; else fail "path is ${path:-unknown}, want $want: $(peer_line "$a")"; fi
}

run_pair lab-lan lab-a lab-b direct

# Access rules on the LAN pair: deny by default, then let lab-a reach lab-b's
# port 8080 and everyone ping. Replies to allowed connections get back.
echo
echo "==> access rules (lab-a, lab-b)"
acl_network=$LAST_NETWORK
a4=$(ip_of lab-a IPv4); b4=$(ip_of lab-b IPv4)
a_id=$(docker exec meshguard-lab-a meshguard status --json | json .device.id)
b_id=$(docker exec meshguard-lab-b meshguard status --json | json .device.id)
for port in 8080 9090; do docker exec -d meshguard-lab-b nc -lk "$port"; done
expect_traffic allowed "lab-a -> lab-b:8080 before rules" can_connect lab-a "$b4" 8080

if out=$(docker exec meshguard-lab-a meshguard doctor lab-b --port 8080); then
  ok "lab-a: meshguard doctor lab-b --port 8080 finds no problems"
else
  fail "lab-a: meshguard doctor lab-b --port 8080:"; echo "$out"
fi
got=$(doctor_detail lab-b listening --port 8080)
if [[ "$got" == on* ]]; then ok "lab-b doctor --port 8080: listening $got"; else fail "lab-b doctor --port 8080: '$got'"; fi
if docker exec meshguard-lab-a meshguard doctor lab-b --port 7070 >/dev/null; then
  fail "doctor lab-b --port 7070 passed, but nothing listens there"
else
  ok "doctor lab-b --port 7070 fails: $(doctor_detail lab-a port lab-b --port 7070)"
fi

patch "/v1/networks/$acl_network/acl" '{"defaultAction":"deny"}' >/dev/null
expect_traffic blocked "lab-a -> lab-b ping, deny without rules" can_ping lab-a "$b4"
expect_traffic blocked "lab-b -> lab-a ping, deny without rules" can_ping lab-b "$a4"
expect_traffic blocked "lab-a -> lab-b:8080, deny without rules" can_connect lab-a "$b4" 8080

post "/v1/networks/$acl_network/acl/rules" \
  "{\"sourceDeviceId\":\"$a_id\",\"destinationDeviceId\":\"$b_id\",\"protocol\":\"tcp\",\"portFrom\":8080}" >/dev/null
expect_traffic allowed "lab-a -> lab-b:8080 by rule" can_connect lab-a "$b4" 8080
expect_traffic blocked "lab-a -> lab-b:9090, not in the rule" can_connect lab-a "$b4" 9090
expect_traffic blocked "lab-a -> lab-b ping, not in the rule" can_ping lab-a "$b4"
for check in "8080:every peer may connect" "9090:no peer may connect to tcp/9090"; do
  port=${check%%:*} want=${check#*:}
  got=$(doctor_detail lab-b access --port "$port")
  if [ "$got" = "$want" ]; then ok "lab-b doctor --port $port: $got"; else fail "lab-b doctor --port $port: '$got', want '$want'"; fi
done

post "/v1/networks/$acl_network/acl/rules" \
  '{"sourceDeviceId":null,"destinationDeviceId":null,"protocol":"icmp"}' >/dev/null
expect_traffic allowed "lab-a -> lab-b ping by rule" can_ping lab-a "$b4"
expect_traffic allowed "lab-b -> lab-a ping by rule" can_ping lab-b "$a4"
dropped=$(docker exec meshguard-lab-b meshguard status --json | json .acl.dropped)
if [ "${dropped:-0}" -gt 0 ]; then ok "lab-b counted $dropped refused packets"; else fail "lab-b counted no refused packets"; fi
docker exec meshguard-lab-b meshguard status | grep access

# Sanity: lab-f can't open a connection into lab-e's NAT on its own.
if docker exec meshguard-lab-f ping -c 1 -W 1 10.201.0.10 >/dev/null 2>&1; then
  fail "lab-f reaches lab-e's LAN address; the NAT test would be meaningless"
else
  echo; ok "lab-f cannot reach lab-e's LAN address 10.201.0.10 outside the mesh"
fi
run_pair lab-nat lab-e lab-f direct

# lab-f moves to a new address, as on a new Wi-Fi: it rebinds and both sides
# find the direct path again at the new address.
echo
echo "==> lab-f changes address 10.200.0.30 -> 10.200.0.31"
docker exec meshguard-lab-f sh -c '
  dev=$(ip -o -4 addr show | awk "/10.200.0.30/ {print \$2}")
  ip addr del 10.200.0.30/24 dev "$dev" && ip addr add 10.200.0.31/24 dev "$dev"'
start=$(date +%s)
moved=""
for _ in $(seq 60); do
  if [ "$(peer_path lab-e)" = direct ] && peer_line lab-e | grep -q 10.200.0.31; then moved=1; break; fi
  sleep 1
done
if [ -n "$moved" ]; then ok "direct to the new address after $(($(date +%s) - start))s"; else fail "still not direct to 10.200.0.31: $(peer_line lab-e)"; fi
check_ping lab-e "$(ip_of lab-f IPv4)"
check_ping lab-f "$(ip_of lab-e IPv4)"
run_pair lab-symmetric lab-g lab-h relay

echo
docker exec meshguard-lab-e meshguard status
exit $status
