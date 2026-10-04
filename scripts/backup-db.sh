#!/usr/bin/env bash
# Daily SQLite backup with 7-day retention. VACUUM INTO = consistent snapshot
# even while the server writes. Never touches the live db except reading.
set -euo pipefail
cd /root/affiliate-tools
mkdir -p data/backups
ts=$(date +%Y%m%d-%H%M)
out="data/backups/affiliate-$ts.db"
python3 - "$out" <<'PY'
import sqlite3, sys
src = sqlite3.connect("data/affiliate.db")
src.execute("VACUUM INTO ?", (sys.argv[1],))
src.close()
PY
cnt=$(python3 -c "import sqlite3;print(sqlite3.connect('$out').execute('SELECT COUNT(*) FROM content').fetchone()[0])")
live=$(python3 -c "import sqlite3;print(sqlite3.connect('data/affiliate.db').execute('SELECT COUNT(*) FROM content').fetchone()[0])")
[ "$cnt" = "$live" ] || { echo "BACKUP-VERIFY-FAIL snapshot=$cnt live=$live"; exit 1; }
gzip -f "$out"
ls -t data/backups/affiliate-*.db.gz 2>/dev/null | tail -n +8 | xargs -r rm -f
echo "BACKUP-OK affiliate-$ts.db.gz content=$cnt"
