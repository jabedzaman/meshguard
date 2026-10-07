#!/usr/bin/env bash
# MeshGuard lab on the e2e stack (see the lab section in docker-compose.override.yaml):
#   lab-a ↔ lab-b  share a LAN                    → direct
#   lab-e ↔ lab-f  e behind a cone NAT, f public  → direct through e's NAT
#   lab-g ↔ lab-h  g symmetric NAT, h cone NAT    → relay
#   lab-r, lab-s   lab-r routes 192.168.50.0/24 (where only lab-s lives) for lab-b
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
dns_resolver() { docker exec "meshguard-$1" meshguard status --json | json .dns.resolver; }

echo "==> migrating the e2e database"
DATABASE_URL=${E2E_DATABASE_URL:-postgres://meshguard:meshguard@localhost:5432/meshguard_test} \
  pnpm --silent --filter @meshguard/db db:migrate >/dev/null

echo "==> starting relay, api-e2e and the lab"
docker rm -f meshguard-lab-c meshguard-lab-d >/dev/null 2>&1 || true   # from the previous lab layout
docker compose up -d --build relay >/dev/null
docker compose --profile e2e up -d api-e2e >/dev/null
for _ in $(seq 60); do curl -sf "$API/healthz" >/dev/null && break; sleep 1; done
docker compose --profile lab up -d --build --force-recreate \
  router-e router-g router-h lab-a lab-b lab-r lab-s lab-e lab-f lab-g lab-h >/dev/null

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
    docker exec "meshguard-$device" meshguard up --token "$token" --server "$LAB_API" | sed -n 1p
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
  local b_name resolver resolved
  b_name=$(dns_name "$b"); resolver=$(dns_resolver "$a")
  resolved=$(docker exec "meshguard-$a" dig +short +time=2 +tries=1 @"$resolver" "$b_name" A)
  if [ "$resolved" = "$b4" ]; then ok "$a resolves $b_name -> $b4"; else fail "$a resolves $b_name to '${resolved}', want $b4"; fi
  resolved=$(docker exec "meshguard-$a" dig +short +time=2 +tries=1 @"$resolver" -x "$b4")
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
  "{\"source\":\"device:$a_id\",\"destination\":\"device:$b_id\",\"protocol\":\"tcp\",\"portFrom\":8080}" >/dev/null
expect_traffic allowed "lab-a -> lab-b:8080 by rule" can_connect lab-a "$b4" 8080
expect_traffic blocked "lab-a -> lab-b:9090, not in the rule" can_connect lab-a "$b4" 9090
expect_traffic blocked "lab-a -> lab-b ping, not in the rule" can_ping lab-a "$b4"
for check in "8080:every peer may connect" "9090:no peer may connect to tcp/9090"; do
  port=${check%%:*} want=${check#*:}
  got=$(doctor_detail lab-b access --port "$port")
  if [ "$got" = "$want" ]; then ok "lab-b doctor --port $port: $got"; else fail "lab-b doctor --port $port: '$got', want '$want'"; fi
done

post "/v1/networks/$acl_network/acl/rules" \
  '{"source":"*","destination":"*","protocol":"icmp"}' >/dev/null
expect_traffic allowed "lab-a -> lab-b ping by rule" can_ping lab-a "$b4"
expect_traffic allowed "lab-b -> lab-a ping by rule" can_ping lab-b "$a4"
dropped=$(docker exec meshguard-lab-b meshguard status --json | json .acl.dropped)
if [ "${dropped:-0}" -gt 0 ]; then ok "lab-b counted $dropped refused packets"; else fail "lab-b counted no refused packets"; fi
docker exec meshguard-lab-b meshguard status | grep access

# Subnet routes: lab-r advertises 192.168.50.0/24, which only it can reach
# (lab-s lives there); lab-b accepts routes. Nothing flows until an admin approves.
echo
echo "==> subnet routes (lab-r routes 192.168.50.0/24 for lab-b)"
sub_network=$(post /v1/networks '{"name":"lab-subnet"}' | json .id)
docker exec meshguard-lab-b meshguard logout --force >/dev/null   # leaves lab-lan
for device in lab-r lab-b; do
  token=$(post "/v1/networks/$sub_network/enrollment-tokens" '{}' | json .token)
  docker exec "meshguard-$device" meshguard up --token "$token" --server "$LAB_API" | sed -n 1p
done
r_id=$(docker exec meshguard-lab-r meshguard status --json | json .device.id)
r4=$(ip_of lab-r IPv4); b4=$(ip_of lab-b IPv4)
host=192.168.50.10
docker exec -d meshguard-lab-s nc -lk 8080
# Some Docker hosts (OrbStack) route between networks whatever "internal" says,
# so say that lab-b is not on that LAN: nothing may leave it that way except
# through the mesh.
docker exec meshguard-lab-b iptables -A OUTPUT -d 192.168.50.0/24 ! -o meshguard0 -j REJECT
if can_ping lab-b "$host"; then fail "lab-b reaches $host outside the mesh; the routes test would be meaningless"
else ok "lab-b cannot reach $host outside the mesh"; fi

docker exec meshguard-lab-r meshguard set --advertise-routes 192.168.50.0/24 >/dev/null
docker exec meshguard-lab-b meshguard set --accept-routes >/dev/null
expect_traffic blocked "lab-b -> $host before approval" can_ping lab-b "$host"
pending=$(curl -sf -b "$COOKIES" -H "Origin: $WEB" "$API/v1/networks/$sub_network/devices" |
  node -pe 'JSON.parse(require("fs").readFileSync(0, "utf8")).flatMap(d => d.routes).map(r => r.prefix + ":" + r.approved).join()')
if [ "$pending" = "192.168.50.0/24:false" ]; then ok "the route waits for approval ($pending)"; else fail "route state '$pending'"; fi

put() { curl -sf -m 15 -X PUT -b "$COOKIES" -c "$COOKIES" -H "Origin: $WEB" -H 'Content-Type: application/json' -d "$2" "$API$1"; }
put "/v1/devices/$r_id/routes" '{"approved":["192.168.50.0/24"]}' >/dev/null
expect_traffic allowed "lab-b -> $host ping through lab-r" can_ping lab-b "$host"
expect_traffic allowed "lab-b -> $host:8080 through lab-r" can_connect lab-b "$host" 8080
if docker exec meshguard-lab-b ip route get "$host" | grep -q "dev meshguard0"; then ok "lab-b routes $host through meshguard0"; else fail "lab-b does not route $host through meshguard0"; fi
docker exec meshguard-lab-b meshguard status | grep -E "serving|accepting|routes" || true
docker exec meshguard-lab-r meshguard status | grep -E "serving|accepting|routes" || true

# Revoking takes the route away again.
put "/v1/devices/$r_id/routes" '{"approved":[]}' >/dev/null
expect_traffic blocked "lab-b -> $host after revoking" can_ping lab-b "$host"
put "/v1/devices/$r_id/routes" '{"approved":["192.168.50.0/24"]}' >/dev/null
expect_traffic allowed "lab-b -> $host after approving again" can_ping lab-b "$host"

# Access rules cover the subnet too: under deny, lab-b needs a rule that lets
# it reach lab-r.
patch "/v1/networks/$sub_network/acl" '{"defaultAction":"deny"}' >/dev/null
expect_traffic blocked "lab-b -> $host, deny without rules" can_ping lab-b "$host"
b_id=$(docker exec meshguard-lab-b meshguard status --json | json .device.id)
post "/v1/networks/$sub_network/acl/rules" \
  "{\"source\":\"device:$b_id\",\"destination\":\"device:$r_id\",\"protocol\":\"any\"}" >/dev/null
expect_traffic allowed "lab-b -> $host by a rule for lab-r" can_ping lab-b "$host"

# Without accept-routes lab-b stops using the route.
docker exec meshguard-lab-b meshguard set --accept-routes=false >/dev/null
expect_traffic blocked "lab-b -> $host without accept-routes" can_ping lab-b "$host"

# Stop advertising: the router's NAT rule goes away.
docker exec meshguard-lab-r meshguard set --advertise-routes "" >/dev/null
for _ in $(seq 20); do
  docker exec meshguard-lab-r iptables -t nat -S POSTROUTING | grep -q 192.168.50.0 || break; sleep 1
done
if docker exec meshguard-lab-r iptables -t nat -S POSTROUTING | grep -q 192.168.50.0; then fail "lab-r still masquerades 192.168.50.0/24"; else ok "lab-r removed its NAT rule"; fi

# Exit node: lab-b sends everything through lab-r, which can reach lab-s (the
# "internet" for this test: 192.168.50.10 is not on lab-b's LAN and is not a
# route). The agent's own traffic must keep working around the tunnel.
echo
echo "==> exit node (lab-b sends its traffic through lab-r)"
docker exec meshguard-lab-r meshguard set --advertise-exit-node >/dev/null
docker exec meshguard-lab-b meshguard set --exit-node lab-r >/dev/null
expect_traffic blocked "lab-b -> $host before the exit node is approved" can_ping lab-b "$host"
exit_state=$(curl -sf -b "$COOKIES" -H "Origin: $WEB" "$API/v1/networks/$sub_network/devices" |
  node -pe 'JSON.parse(require("fs").readFileSync(0, "utf8")).flatMap(d => d.routes).map(r => r.prefix + ":" + r.approved).join()')
if [ "$exit_state" = "0.0.0.0/0:false,::/0:false" ]; then ok "the exit node waits for approval ($exit_state)"; else fail "exit node state '$exit_state'"; fi
lb_problem=$(docker exec meshguard-lab-b meshguard status --json | json .problem)
case "$lb_problem" in *"approved"*) ok "lab-b says why: $lb_problem";; *) fail "lab-b problem: '$lb_problem'";; esac

put "/v1/devices/$r_id/routes" '{"approved":["0.0.0.0/0","::/0"]}' >/dev/null
expect_traffic allowed "lab-b -> $host ping through the exit node" can_ping lab-b "$host"
expect_traffic allowed "lab-b -> $host:8080 through the exit node" can_connect lab-b "$host" 8080
lb_exit=$(docker exec meshguard-lab-b meshguard status --json | json .exitNode)
if [ "$lb_exit" = lab-r ]; then ok "lab-b status: exit node $lb_exit"; else fail "lab-b exit node '$lb_exit'"; fi
if docker exec meshguard-lab-b ip route get 192.168.50.10 mark 0 | grep -q "dev meshguard0"; then ok "lab-b's unmarked traffic goes through meshguard0"; else fail "lab-b's traffic does not use meshguard0"; fi
if docker exec meshguard-lab-b ip route get 10.200.0.10 mark 51820 | grep -q "dev eth0"; then ok "the agent's own (marked) traffic stays on eth0"; else fail "marked traffic is routed into the tunnel"; fi
# The control plane and relay stay reachable around the tunnel: lab-b keeps syncing.
sleep 3
lb_state=$(docker exec meshguard-lab-b meshguard status --json | json .state)
if [ "$lb_state" = connected ]; then ok "lab-b stays connected to the control plane and relay"; else fail "lab-b state is $lb_state"; fi
docker exec meshguard-lab-r meshguard status | grep -E "serving" || true
docker exec meshguard-lab-b meshguard status | grep -E "exit node" || true

# Stopping the exit node hands traffic back to the normal routes.
docker exec meshguard-lab-b meshguard set --exit-node "" >/dev/null
expect_traffic blocked "lab-b -> $host after leaving the exit node" can_ping lab-b "$host"
if docker exec meshguard-lab-b ip rule | grep -q 51820; then fail "lab-b still has exit node rules"; else ok "lab-b removed its exit node rules"; fi

# Revoking the exit node stops it for good.
docker exec meshguard-lab-b meshguard set --exit-node lab-r >/dev/null
expect_traffic allowed "lab-b -> $host through the exit node again" can_ping lab-b "$host"
put "/v1/devices/$r_id/routes" '{"approved":[]}' >/dev/null
expect_traffic blocked "lab-b -> $host after the exit node is revoked" can_ping lab-b "$host"
docker exec meshguard-lab-b meshguard set --exit-node "" >/dev/null
docker exec meshguard-lab-r meshguard set --advertise-exit-node=false >/dev/null

# Services: "web" is hosted by lab-r and lab-a; lab-b connects to its address
# and always reaches one online host, whichever it is.
echo
echo "==> services (web hosted by lab-r and lab-a, used by lab-b)"
svc_network=$(post /v1/networks '{"name":"lab-services"}' | json .id)
for device in lab-r lab-a lab-b; do   # lab-r first: it is the first host
  docker exec "meshguard-$device" meshguard logout --force >/dev/null 2>&1 || true
  token=$(post "/v1/networks/$svc_network/enrollment-tokens" '{}' | json .token)
  docker exec "meshguard-$device" meshguard up --token "$token" --server "$LAB_API" | sed -n 1p
done
r_id=$(docker exec meshguard-lab-r meshguard status --json | json .device.id)
a_id=$(docker exec meshguard-lab-a meshguard status --json | json .device.id)
b_id=$(docker exec meshguard-lab-b meshguard status --json | json .device.id)
for device in lab-r lab-a; do
  docker exec -d "meshguard-$device" sh -c 'while true; do echo "served by $(hostname)" | nc -l 8080 -q 1; done'
done
svc_vip=$(post "/v1/networks/$svc_network/services" "{\"name\":\"web\",\"hostDeviceIds\":[\"$r_id\",\"$a_id\"]}" | json .vip)
svc_id=$(curl -sf -b "$COOKIES" -H "Origin: $WEB" "$API/v1/networks/$svc_network/services" | json "[0].id")
ok "service web has address $svc_vip"
domain=$(docker exec meshguard-lab-b meshguard status --json | json .dns.domain)
svc_name="web.svc.$domain"

# ask <seconds> <expected>: lab-b connects to the service address until it hears <expected>.
ask() { docker exec meshguard-lab-b sh -c "nc -w 3 $svc_vip 8080 </dev/null 2>/dev/null"; }
expect_answer() {
  local what=$1 want=$2 seconds=${3:-30} got=""
  for _ in $(seq "$seconds"); do
    got=$(ask || true)
    [ "$got" = "$want" ] && { ok "$what: $want"; return; }
    sleep 1
  done
  fail "$what: '$got', want '$want'"
}

expect_answer "lab-b -> web ($svc_vip) reaches the first host" "served by lab-r"
resolver=$(dns_resolver lab-b)
resolved=$(docker exec meshguard-lab-b dig +short +time=2 +tries=1 @"$resolver" "$svc_name" A)
if [ "$resolved" = "$svc_vip" ]; then ok "lab-b resolves $svc_name -> $svc_vip"; else fail "lab-b resolves $svc_name to '$resolved', want $svc_vip"; fi
resolved=$(docker exec meshguard-lab-b dig +short +time=2 +tries=1 @"$resolver" -x "$svc_vip")
if [ "$resolved" = "$svc_name." ]; then ok "lab-b resolves $svc_vip -> $svc_name"; else fail "lab-b resolves $svc_vip to '$resolved', want $svc_name."; fi
if docker exec meshguard-lab-b meshguard services | grep -q "web .*$svc_vip .*lab-r"; then ok "meshguard services shows web served by lab-r"; else fail "meshguard services: $(docker exec meshguard-lab-b meshguard services)"; fi
if can_ping lab-b "$svc_vip"; then ok "lab-b pings the service address"; else fail "lab-b cannot ping $svc_vip"; fi

# The first host goes offline (its presence expires after about 30s): the next takes over.
docker exec meshguard-lab-r meshguard down >/dev/null
expect_answer "web fails over to lab-a" "served by lab-a" 90
docker exec meshguard-lab-r meshguard up >/dev/null
expect_answer "web returns to lab-r when it is back" "served by lab-r" 60

# Access rules can name the service: with deny, only a rule for service:web lets lab-b in.
patch "/v1/networks/$svc_network/acl" '{"defaultAction":"deny"}' >/dev/null
expect_traffic blocked "lab-b -> web:8080, deny without rules" can_connect lab-b "$svc_vip" 8080
post "/v1/networks/$svc_network/acl/rules" \
  "{\"source\":\"device:$b_id\",\"destination\":\"service:web\",\"protocol\":\"tcp\",\"portFrom\":8080}" >/dev/null
expect_answer "lab-b -> web:8080 by a rule for service:web" "served by lab-r" 40
expect_traffic blocked "lab-b -> web ping, not in the rule" can_ping lab-b "$svc_vip"

# Changing the hosts moves traffic; deleting the service ends it.
put "/v1/services/$svc_id/hosts" "{\"hostDeviceIds\":[\"$a_id\"]}" >/dev/null
expect_answer "web moves to lab-a when lab-r stops hosting" "served by lab-a" 40
curl -sf -m 15 -X DELETE -b "$COOKIES" -H "Origin: $WEB" "$API/v1/services/$svc_id" >/dev/null
expect_traffic blocked "lab-b -> web after deleting the service" can_connect lab-b "$svc_vip" 8080
resolved=$(docker exec meshguard-lab-b dig +time=2 +tries=1 @"$resolver" "$svc_name" A | grep -c "status: NXDOMAIN" || true)
if [ "$resolved" = 1 ]; then ok "$svc_name no longer resolves"; else fail "$svc_name still resolves"; fi

# Sanity: lab-f can't open a connection into lab-e's NAT on its own. (Same
# reason for the unreachable route as above.)
docker exec meshguard-lab-f ip route add unreachable 10.201.0.0/24 || true
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
