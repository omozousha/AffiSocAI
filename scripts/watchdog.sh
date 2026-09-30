#!/bin/bash
# Watchdog: restart server bila mati. Dipanggil cron hermes tiap 15 menit.
if curl -sf http://127.0.0.1:8787/ --max-time 8 -o /dev/null; then exit 0; fi
PIDS=$(ps aux | grep '[n]ode.*server.ts' | awk '{print $2}')
[ -n "$PIDS" ] && kill $PIDS 2>/dev/null; sleep 3
cd /root/affiliate-tools && { nohup node --experimental-strip-types src/api/server.ts >> /root/.affiliate-tools/watchdog.log 2>&1 & }
sleep 6; curl -sf http://127.0.0.1:8787/ --max-time 8 -o /dev/null && echo RESTARTED || echo FAILED
