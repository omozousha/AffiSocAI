# affiliate-tools

Auto-posting affiliate Shopee ke Instagram, Facebook, Threads. Satu slot = satu
produk ke semua platform aktif. Scheduler in-process, UI React dark-only.

## Arsitektur

```
Shopee link → scraper (og: tags) → produk tersimpan
→ konten AI (mystery caption, 16 kategori) → gambar AI (4-rung chain)
→ slot jadwal → tick 60 detik → posting fan-out IG + FB + Threads
```

- Backend: Node.js + SQLite (`node:sqlite`), server di `src/api/server.ts`
- Frontend: React + TS + Tailwind v4 + shadcn-style UI di `web/`, build ke `public/dist/`
- Provider: `src/providers/` (instagram, facebook, threads, tiktok-boundary)
- Scheduler: `src/core/scheduler.ts` — tick 60 detik, horizon 2 hari, idempotent

## Prasyarat

- Node.js 20+ (atau Bun)
- Akun Composio untuk IG/FB, aplikasi Meta untuk Threads API

## Cara pakai

```bash
cp .env.example .env   # isi kredensial, JANGAN commit .env
npm install
npm start              # http://localhost:8787
```

Frontend dev:

```bash
cd web && npm install && npm run build   # output ke public/dist/
```

## Alur kerja

1. **Link** — tambah link Shopee (shortlink lolos, URL panjang bisa 403 IP-level).
   Dry-run dulu untuk cek hasil scrape sebelum simpan.
2. **Konten** — generate caption (mystery/direct), edit draf, simpan.
3. **Jadwal** — tambah jam posting (HH:MM). Jam yang masih di depan hari ini
   masuk slot hari ini; yang sudah lewat masuk besok. Maks 6 jam.
   Tick scheduler tiap 60 detik posting slot yang due secara otomatis.
4. **Sosmed** — status provider, publish test, validate payload.
5. **Logs** — aktivitas request + error, live tail via SSE.

## API ringkas

| Method | Path | Fungsi |
|---|---|---|
| GET/POST/DELETE | `/api/links` | Kelola link + enrich + recreate-image |
| GET/POST | `/api/content` | Generate + simpan konten |
| GET | `/api/schedule?window=7` | Status + slot + tren |
| POST | `/api/schedule/add-time` | Tambah jam (`{"slot_time":"HH:MM"}`) |
| POST | `/api/schedule/config` | Set `slot_times` / `enabled` |
| POST | `/api/schedule/run` | Jalankan slot manual |
| GET | `/api/schedule/health` | Health scheduler |
| GET | `/api/providers` | Status provider |
| GET | `/api/logs` + `/api/logs/stream` | Log + SSE live tail |

## Keamanan

Repo ini BERSIH dari secret: `.env`, `*.db`, `node_modules/`, `deploy/*.env`
masuk `.gitignore`. Kredensial hanya lewat environment variable.
Docs login (`docs/THREADS-LOGIN.md`) tidak di-push — itu alur operasional lokal.

## Lisensi

Private — all rights reserved.
