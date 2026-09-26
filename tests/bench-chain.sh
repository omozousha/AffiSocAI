#!/bin/bash
cd /root/affiliate-tools
pass=0; fail=0
for i in $(seq 1 6); do
  out=$(AFFILIATE_ROUTER_KEY="$HERMES_CUSTOM_ROUTER_REALPAYTRANS_MY_ID_API_KEY" timeout 180 \
    node --experimental-strip-types tests/router-image.ts rec /tmp/src.jpg 2>&1)
  if echo "$out" | grep -q "recreateImage ->"; then
    pass=$((pass+1)); echo "  run $i PASS"
  else
    fail=$((fail+1)); echo "  run $i FAIL: $(echo "$out" | grep -oE 'RouterError.*' | head -c 180)"
  fi
  sleep 3
done
echo "CHAIN RESULT: PASS=$pass FAIL=$fail"
