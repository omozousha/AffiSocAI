#!/bin/bash
# Watchdog: panggil oleh cron hermes tiap 15 menit.
# Normal (HTTP 200) -> exit 0 tanpa output.
# Mati -> restart via systemd (satu-satunya supervisor yang sah; jangan nohup:
# itu warisan pre-systemd yang bikin dua process berebut port 8787).
# Gagal restart -> tulis ALERT + exit 1 supaya cron melapor.
ALERT=/root/.affiliate-tools/watchdog-alert.txt
if curl -sf http://127.0.0.1:8787/ --max-time 8 -o /dev/null; then
  rm -f "$ALERT"
  exit 0
fi
systemctl --user restart affiliate-tools.service 2>>/root/.affiliate-tools/watchdog.log
sleep 8
if curl -sf http://127.0.0.1:8787/ --max-time 8 -o /dev/null; then
  rm -f "$ALERT"; echo RESTARTED; exit 0
fi
echo "$(date -Is) server DOWN, systemd restart FAILED" > "$ALERT"
echo FAILED; exit 1
