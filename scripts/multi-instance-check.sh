#!/usr/bin/env bash
# Multi-instance no-overbooking check (BRD §5 "Multi-Process Safety").
#
# Fires many simultaneous seat requests split across TWO backend instances that share ONE database,
# then double-clicks "confirm" on every winning hold on BOTH instances, and verifies — through the API
# and directly in PostgreSQL — that held + confirmed never exceeds totalSeats.
#
# Prerequisite:  docker compose --profile multi up -d --build
# Usage:         ./scripts/multi-instance-check.sh [SEATS=10] [REQUESTS=500]
# Env:           API_A (default http://localhost:8080), API_B (default http://localhost:8081)
# Needs:         bash, curl, xargs, docker (no jq).
set -euo pipefail

SEATS="${1:-10}"
REQUESTS="${2:-500}"
API_A="${API_A:-http://localhost:8080}"
API_B="${API_B:-http://localhost:8081}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }
json_field() { grep -oE "\"$1\":(\"[^\"]*\"|[0-9]+)" | head -1 | sed -E "s/\"$1\"://; s/\"//g"; }

# ---------- 0. both instances healthy ----------
for api in "$API_A" "$API_B"; do
  status="$(curl -s -o /dev/null -w '%{http_code}' "$api/health" || true)"
  [[ "$status" == "200" ]] || fail "$api/health returned '$status'. Start both: docker compose --profile multi up -d --build"
done
echo "✔ both instances healthy: $API_A  $API_B"

# ---------- 1. a fresh class ----------
class_name="Multi-instance check $(date +%s)-$RANDOM"
class_json="$(curl -s -X POST "$API_A/classes" -H 'Content-Type: application/json' \
  -d "{\"name\":\"$class_name\",\"totalSeats\":$SEATS}")"
CLASS_ID="$(echo "$class_json" | json_field id)"
[[ "$CLASS_ID" == c_* ]] || fail "could not create class: $class_json"
echo "✔ class $CLASS_ID with $SEATS seats"

# ---------- 2. REQUESTS simultaneous applies, alternating instances ----------
apply_one() { # $1 = index
  local i="$1" api student code
  if (( i % 2 == 0 )); then api="$API_A"; else api="$API_B"; fi
  student="$(printf '2026%013d' "$i")"
  code="$(curl -s -o "$WORK/apply-$i.json" -w '%{http_code}' -X POST "$api/classes/$CLASS_ID/holds" -H "X-Student-Id: $student")"
  echo "$code $api $student $i"
}
export -f apply_one
export API_A API_B CLASS_ID WORK

echo "… firing $REQUESTS simultaneous applies (even → A, odd → B)"
seq 1 "$REQUESTS" | xargs -P "$REQUESTS" -I{} bash -c 'apply_one {}' > "$WORK/apply.log"

created="$(grep -c '^201 ' "$WORK/apply.log" || true)"
full="$(grep -c '^409 ' "$WORK/apply.log" || true)"
other="$(grep -vcE '^(201|409) ' "$WORK/apply.log" || true)"
created_a="$(grep -c "^201 $API_A " "$WORK/apply.log" || true)"
created_b="$(grep -c "^201 $API_B " "$WORK/apply.log" || true)"
echo "  201 Created: $created (instance A: $created_a, instance B: $created_b) | 409 Conflict: $full | other: $other"
[[ "$other" == "0" ]] || { grep -vE '^(201|409) ' "$WORK/apply.log" | head -5; fail "unexpected status codes"; }
[[ "$created" == "$SEATS" ]] || fail "expected exactly $SEATS holds, got $created"
echo "✔ exactly $SEATS of $REQUESTS requests got a seat"

# ---------- 3. double-click confirm on BOTH instances for every winner ----------
confirm_pair() { # $1 = "index student"
  local i student hold
  read -r i student <<< "$1"
  hold="$(grep -oE '"holdId":"h_[0-9a-f]+"' "$WORK/apply-$i.json" | sed -E 's/.*"(h_[0-9a-f]+)"/\1/')"
  for api in "$API_A" "$API_B"; do
    curl -s -o /dev/null -w '%{http_code}\n' -X POST "$api/holds/$hold/confirm" -H "X-Student-Id: $student" &
  done
  wait
}
export -f confirm_pair
grep '^201 ' "$WORK/apply.log" | awk '{print $4" "$3}' \
  | xargs -P "$SEATS" -I{} bash -c 'confirm_pair "{}"' > "$WORK/confirm.log"
ok="$(grep -c '^200$' "$WORK/confirm.log" || true)"
[[ "$ok" == "$(( SEATS * 2 ))" ]] || fail "expected $(( SEATS * 2 )) idempotent 200s from confirms, got $ok"
echo "✔ $ok confirm calls (2 per hold, one on each instance) all returned 200"

# ---------- 4. both instances report the same, correct numbers ----------
for api in "$API_A" "$API_B"; do
  stats="$(curl -s "$api/classes/$CLASS_ID")"
  held="$(echo "$stats" | json_field heldSeats)"; confirmed="$(echo "$stats" | json_field confirmedSeats)"
  available="$(echo "$stats" | json_field availableSeats)"; total="$(echo "$stats" | json_field totalSeats)"
  echo "  API $api → total=$total held=$held confirmed=$confirmed available=$available"
  (( held + confirmed <= total )) || fail "API reports overbooking on $api"
  [[ "$confirmed" == "$SEATS" && "$held" == "0" && "$available" == "0" ]] || fail "unexpected stats on $api"
done
echo "✔ API: held + confirmed <= totalSeats on both instances; each confirm counted once"

# ---------- 5. ground truth from PostgreSQL ----------
uuid="${CLASS_ID#c_}"
uuid="${uuid:0:8}-${uuid:8:4}-${uuid:12:4}-${uuid:16:4}-${uuid:20:12}"
row="$(cd "$ROOT" && docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA -F " "' <<SQL
SELECT c.total_seats, c.held_seats, c.confirmed_seats,
       count(h.id) FILTER (WHERE h.status = 'HELD'),
       count(h.id) FILTER (WHERE h.status = 'CONFIRMED')
FROM classes c LEFT JOIN holds h ON h.class_id = c.id
WHERE c.id = '$uuid' GROUP BY c.id;
SQL
)"
read -r total held confirmed held_rows confirmed_rows <<< "$row"
echo "  DB → total=$total held_seats=$held confirmed_seats=$confirmed | rows: HELD=$held_rows CONFIRMED=$confirmed_rows"
(( held + confirmed <= total )) || fail "DATABASE OVERBOOKED"
[[ "$held" == "$held_rows" && "$confirmed" == "$confirmed_rows" ]] || fail "counters drifted from rows"
echo "✔ DB: held + confirmed <= total_seats and counters match the actual rows"

echo
echo "PASS — $REQUESTS concurrent requests across 2 instances, $SEATS seats, no overbooking."
