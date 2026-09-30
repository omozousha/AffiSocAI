# Threads OAuth — Opsi A (Official Meta API)

> Goal: Threads bisa auto-post via `graph.threads.com`.
> Sisa stack sudah live: IG/FB verified, scheduler 09:00/13:00/19:00 WIB, 2 slot hari ini published.

## Ringkas

- Threads pakai OAuth 2.0 official, bukan cookie.
- Adapter di `src/providers/threads.ts` sudah siap, endpoint `graph.threads.com`.
- Yang belum ada: **Meta App** + file kredensial `~/.affiliate-tools/threads/app.json` (mode 0600).
- Tanpa ini `GET /api/providers/threads/authorize` return `503 app credentials not configured`.

## 1. Buat Meta App (10 menit, sekali)

1. Buka https://developers.facebook.com → **My Apps** → **Create App**.
2. Use case: **Other** → Type: **Business**.
3. **Add Product** → **Threads** → **Set up**.
4. Di Threads settings, tambah **Redirect URI** (harus exact):
   ```
   https://affine.realpaytrans.my.id/api/providers/threads/callback
   ```
5. Copy **App ID** dan **App Secret** (Settings → Basic).

> Catatan: domain `affine.realpaytrans.my.id` harus sudah point ke VPS ini (sudah, dipakai `BIO_PUBLIC_BASE`).

## 2. Isi kredensial ke VPS

Jalankan di VPS (ganti `PASTE_*`):

```bash
mkdir -p ~/.affiliate-tools/threads
cat > ~/.affiliate-tools/threads/app.json <<'JSON'
{
  "client_id": "PASTE_APP_ID",
  "client_secret": "PASTE_APP_SECRET",
  "redirect_uri": "https://affine.realpaytrans.my.id/api/providers/threads/callback"
}
JSON
chmod 600 ~/.affiliate-tools/threads/app.json
cat ~/.affiliate-tools/threads/app.json
```

Verifikasi file terbaca:

```bash
node --experimental-strip-types -e "import { readFileSync } from 'node:fs'; console.log(JSON.parse(readFileSync(process.env.HOME+'/.affiliate-tools/threads/app.json','utf8')))"
```

## 3. Restart server (wajib)

Server baca `app.json` saat boot. Tanpa restart, `/authorize` tetap 503.

```bash
# cek PID lama
ps aux | grep '[n]ode src/api/server.ts'
ss -ltnp | grep 8787

# kill by PID only (jangan pkill -f, bisa kill shell)
kill <PID_LAMA>
sleep 2
ss -ltnp | grep 8787 || echo "port free"

# start ulang (flag wajib di host ini)
BIO_PUBLIC_BASE=https://affine.realpaytrans.my.id \
  node --experimental-strip-types src/api/server.ts &
sleep 3
curl -s http://127.0.0.1:8787/api/providers/threads/authorize | head -c 500
# harus return {"url":"https://threads.com/oauth/authorize?client_id=..."}
```

## 4. Hubungkan akun

1. Buka dashboard: `https://affine.realpaytrans.my.id` → **Sosmed** → **Threads** → **Hubungkan**.
2. Browser redirect ke `threads.com/oauth/authorize` → **Authorize**.
3. Meta redirect balik ke `/api/providers/threads/callback?code=...` → server tukar `code` → `short token` → `long-lived token (60 hari)` → simpan 0600 ke `~/.affiliate-tools/threads/token.json` → auto-refresh di 75% umur.
4. UI harusnya jadi `VERIFIED-EXECUTED`.

## 5. Verifikasi (bukti, bukan klaim)

```bash
# session live?
curl -s http://127.0.0.1:8787/api/providers/threads/session | python3 -m json.tool
# expect: {"live": true, "username":"...", ...}

# provider status?
curl -s http://127.0.0.1:8787/api/providers | python3 -c "import sys,json; d=json.load(sys.stdin); print([p for p in d['providers'] if p['slug']=='threads'][0])"

# test publish (butuh mediaUrl public, bukan /api/images/...)
curl -s -X POST http://127.0.0.1:8787/api/providers/threads/publish \
  -H 'Content-Type: application/json' \
  -d '{"text":"test threads autopost — link di bio","mediaUrl":"https://affine.realpaytrans.my.id/api/images/link-13-1790410158688.png"}' | head -c 800

# cek log
curl -s "http://127.0.0.1:8787/api/logs?limit=5&path=threads" | python3 -m json.tool | head -n 60
```

Jika `publish` return `{"ok": true, "postId": "..."}`, Threads sudah masuk scheduler rotation sama seperti IG/FB.

## 6. Scheduler

Tidak perlu config tambahan. Setelah `live:true`, `scheduler.ts:publishablePlatforms()` otomatis include `threads` (capability `imagePost:true`). Slot selanjutnya akan round-robin IG/FB/Threads.

Cek jadwal:

```bash
curl -s http://127.0.0.1:8787/api/schedule | python3 -m json.tool | head -n 80
```

## Troubleshooting

| Gejala | Penyebab | Fix |
|---|---|---|
| `503 app credentials not configured` | `app.json` tidak ada / permission salah | cek `ls -l ~/.affiliate-tools/threads/app.json` harus `600` |
| `redirect_uri mismatch` | URI di Meta App ≠ di `app.json` | samakan exact string |
| `token exchange failed` | code sudah dipakai / expired (1 jam) | klik Hubungkan lagi |
| `Threads must be able to fetch media URL` | pakai `/api/images/...` lokal | pakai `https://affine.realpaytrans.my.id/api/images/...` |
| `publish 422 Threads not connected` | token belum ada | ulang langkah 4 |

## Keamanan

- `token.json` mode 0600, di luar repo, tidak pernah di-print ke log.
- Refresh otomatis; tidak perlu re-auth tiap hari.
- `POST /api/providers/threads/reset` untuk cabut koneksi.

---
Generated: 2026-09-27 — affiliate-tools Opsi A
