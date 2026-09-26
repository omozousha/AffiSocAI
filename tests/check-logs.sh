# Acceptance test for the activity log endpoints and the UI log route.
# Reads only; never mutates links/content.

set -e
cd "$(dirname "$0")/.."
BASE=${BASE:-http://127.0.0.1:8787}

say() { printf '%s\n' "$*"; }
fail=0

check() { # check <label> <condition-desc> <cmd...>
  local label="$1"; shift
  local desc="$1"; shift
  if "$@"; then say "PASS  $label — $desc"; else say "FAIL  $label — $desc"; fail=1; fi
}

has_code() { curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$1" | grep -q "$2"; }

say "target: $BASE"

check "GET /api/logs" "returns 200 with rows+stats" bash -c "
  curl -s --max-time 15 '$BASE/api/logs' | python3 -c 'import sys,json; d=json.load(sys.stdin); assert isinstance(d[\"rows\"],list) and d[\"rows\"], d; assert set([\"total\",\"error\",\"warn\",\"info\"]) <= set(d[\"stats\"])'
"
check "GET /api/logs shape" "row carries id/ts/level/event/status" bash -c "
  curl -s --max-time 15 '$BASE/api/logs' | python3 -c '
import sys,json
r=json.load(sys.stdin)[\"rows\"][0]
for k in (\"id\",\"ts\",\"level\",\"source\",\"event\",\"status\",\"duration_ms\"): assert k in r, k'
"
check "filter level=error" "only error rows returned" bash -c "
  curl -s --max-time 15 '$BASE/api/logs?level=error' | python3 -c '
import sys,json
rs=json.load(sys.stdin)[\"rows\"]
assert all(r[\"level\"]==\"error\" for r in rs)'
"
check "search" "matches on path/message" bash -c "
  curl -s --max-time 15 '$BASE/api/logs?search=/api/links' | python3 -c '
import sys,json
rs=json.load(sys.stdin)[\"rows\"]
assert any(\"/api/links\" in (r[\"path\"] or \"\") or \"/api/links\" in (r[\"message\"] or \"\") for r in rs) or not rs'
"
check "instrumented" "requests are being logged" bash -c "
  curl -s --max-time 15 '$BASE/api/links' >/dev/null
  sleep 0.4
  curl -s --max-time 15 '$BASE/api/logs' | python3 -c '
import sys,json
rs=json.load(sys.stdin)[\"rows\"]
assert any(r[\"path\"]==\"/api/links\" for r in rs)'
"
check "error captured" "500 logs level=error with message" bash -c "
  curl -s -o /dev/null -X POST -H 'content-type: application/json' -d '{broken' '$BASE/api/links'
  sleep 0.4
  curl -s --max-time 15 '$BASE/api/logs?level=error' | python3 -c '
import sys,json
rs=json.load(sys.stdin)[\"rows\"]
hit=[r for r in rs if r[\"status\"]==500 and r.get(\"message\")]
assert hit, rs[:2]'
"
check "404 stays warn" "a not-found route is a client error, not a server error" bash -c "
  curl -s -o /dev/null '$BASE/api/nope-404-probe'
  sleep 0.4
  curl -s --max-time 15 '$BASE/api/logs?level=warn' | python3 -c '
import sys,json
rs=json.load(sys.stdin)[\"rows\"]
hit=[r for r in rs if r[\"status\"]==404 and r[\"level\"]==\"warn\"]
assert hit, rs[:2]'
"
check "route #/logs html" "shell served at public/index.html" bash -c "
  curl -s --max-time 15 '$BASE/' | grep -q 'js/main.js'"
check "route #/logs module" "js/routes/logs.js served" test "$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$BASE/js/routes/logs.js")" = "200"
check "nav has Logs" "sidebar nav lists Logs" bash -c "
  curl -s --max-time 15 '$BASE/' | grep -q '#/logs'"

if [ $fail -eq 0 ]; then say "activity log self-check: ALL PASS"; else say "activity log self-check: FAILURES PRESENT"; fi
exit $fail
