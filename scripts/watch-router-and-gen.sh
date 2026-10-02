#!/usr/bin/env bash
# Watch the 9router image route; regenerate the 4 pending presets for link 3
# as soon as the route is healthy. Logs every attempt.
cd /root/affiliate-tools || exit 1
KEY="${AFFILIATE_ROUTER_KEY:-$HERMES_CUSTOM_ROUTER_REALPAYTRANS_MY_ID_API_KEY}"
PRESETS="gesture-closeup animal-friend character-mascot flatlay-studio"
LOG=/tmp/router-watch.log
REAL_REF="https://down-id.img.susercontent.com/file/id-11134207-822wl-mmt59ryxhlhgb3"

# Put the real Shopee reference back so generation stays image-to-image.
# Guarded so it only fires when image_url has been rewritten to a local path.
restore_reference() {
  node -e '
const{DatabaseSync}=require("node:sqlite");
const d=new DatabaseSync("/root/affiliate-tools/data/affiliate.db");
d.exec("PRAGMA busy_timeout=20000");
const ref=process.argv[1];
d.prepare("update links set image_url=? where id=? and image_url like ?").run(ref,3,"/api/images/%");
console.log("ref:", d.prepare("select image_url from links where id=3").get().image_url);' "$REAL_REF" >>"$LOG" 2>&1
}

# 200 only when the route actually returns an image payload.
probe() {
  curl -s --max-time 90 -X POST "${AFFILIATE_ROUTER_BASE_URL:-https://router2nd.realpaytrans.my.id/v1}/images/generations" \
    -H "content-type: application/json" -H "authorization: Bearer $KEY" \
    -d '{"model":"ag/gemini-3.8-flash","prompt":"red circle on white, no text","n":1}' \
    -o /tmp/watch-probe.json -w "%{http_code}"
}

gen_one() {
  curl -s --max-time 300 -X POST "http://127.0.0.1:8787/api/links/3/recreate-image" \
    -H "x-api-token: ${AFFILIATE_API_TOKEN:-}" \
    -H "content-type: application/json" -d "{\"preset\":\"$1\"}"
}

echo "=== watch start $(date -u +%FT%TZ) ===" >>"$LOG"
for i in $(seq 1 120); do
  CODE=$(probe)
  if [ "$CODE" = "200" ] && grep -q '"data"' /tmp/watch-probe.json; then
    echo "$(date -u +%FT%TZ) route healthy, generating presets" >>"$LOG"
    restore_reference
    for P in $PRESETS; do
      R=$(gen_one "$P")
      echo "$(date -u +%FT%TZ) $P -> $(echo "$R" | python3 -c 'import sys,json
try:
    d=json.load(sys.stdin); print(d.get("mode"),d.get("served_url"),"" if d.get("ok") else "ERR:"+str(d.get("error")))
except Exception as e: print("BADJSON",e)')" >>"$LOG"
    done
    echo "=== WATCHDONE ===" >>"$LOG"
    exit 0
  fi
  echo "$(date -u +%FT%TZ) probe http:$CODE (attempt $i)" >>"$LOG"
  sleep 60
done
echo "=== WATCH GAVE UP after 120 attempts ===" >>"$LOG"
