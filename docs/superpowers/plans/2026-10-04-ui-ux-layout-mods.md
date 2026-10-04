# UI/UX & Layout Modification Plan (AffiSocAI dashboard)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Perbaiki 7 temuan review UI/UX + layout: deep-link routing, skeleton boot, kerapian baris data di mobile, sticky+cap daftar, token palet, kontras/label form login, ritme gap.

**Architecture:** React 19 + Tailwind v4 (`@theme` tokens di `web/src/index.css`), shell `App.tsx` (sidebar sticky + drawer mobile + topbar), 6 route di `web/src/routes/*.tsx`, build `bun run build` (vite, base `/dist/`, outDir `../public/dist` — **dist ikut ter-commit**, pola repo). Server statis tidak perlu restart setelah build.

**Tech Stack:** React, Tailwind v4, lucide-react, komponen ui lokal (`button/badge/card/skeleton/spinner/dialog` — SUDAH ada, pakai lagi, jangan bikin baru).

## Global Constraints

- **Tanpa dependency baru.** `bun add` apa pun = plan ini salah baca.
- Dark-only: jangan tambah light mode / conditional class.
- Copy UI **Bahasa Indonesia konsisten** (temuan #5: hapus EN campur ID).
- Jangan ubah `web/vite.config.ts` (`base:"/dist/"`, outDir, proxy `/api`).
- Sentuh hanya file yang disebut di task; file route yang tidak disebut = tak berubah.
- Setiap task: `cd web && bun run build` harus exit 0 (tsc -b ikut jalan), lalu commit. Akhiri seluruh plan: `bash pushclean.sh`-pattern (tree 0, HEAD==origin/main, secret 0) + `git push`.
- Jangan jalankan publish/slot API apa pun saat verifikasi UI — browser hanya GET halaman.
- Verifikasi browser pakai `browser_exec` (session `uiux`), kredensial login dari prompt user, TIDAK lewat chat.

## Review Focus

Input/failure mode yang tak diuji task tapi paling mungkin menggigit:
1. Hash tak dikenal (`#/%%%`, `#nope`) → wajib fallback Dashboard, bukan blank.
2. Tombol back browser setelah pindah tab via drawer mobile → drawer tertutup, rute ikut hash.
3. Produk dengan judul + URL terpanjang di grid baru → harus truncate, tidak mendorong kolom lain (cek link id 23: judul panjang).
4. Daftar dengan jumlah baris kelipatan pas cap (50, 100) → tombol muat hanya hilang saat sisa 0.
5. `/api/session` gagal (offline/500) → skeleton berhenti, Login tampil — bukan null-screen permanen.

Setiap baris ini punya langkah verifikasi di task pemilik kodenya.

---

### Task 1: Hash routing (deep-link + back button)

**Files:**
- Create: `web/src/lib/routing.ts`
- Create: `web/tests/routing.test.ts`
- Modify: `web/src/App.tsx` (route state, `go()`, `<main>`)

**Interfaces:**
- Produces: `parseHash(h: string): RouteId` (`"#logs"`→`"logs"`, kosong/tak valid→`"dashboard"`); `hashFor(id: RouteId): string`; `ROUTE_IDS: readonly string[]`; `type RouteId`.

- [ ] **Step 1: Tulis test failing**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHash, hashFor, ROUTE_IDS } from "../src/lib/routing.ts";
test("parseHash valid", () => assert.equal(parseHash("#logs"), "logs"));
test("parseHash strip slash", () => assert.equal(parseHash("#/jadwal"), "jadwal"));
test("parseHash invalid/empty -> dashboard", () => {
  assert.equal(parseHash("#nope"), "dashboard");
  assert.equal(parseHash(""), "dashboard");
  assert.equal(parseHash("#%%"), "dashboard");
});
test("hashFor roundtrip", () => assert.equal(parseHash(hashFor("links")), "links"));
```

- [ ] **Step 2:** Run `node --experimental-strip-types --test web/tests/routing.test.ts` → FAIL (module belum ada).
- [ ] **Step 3: Implement `web/src/lib/routing.ts`** — isi persis Interfaces; `ROUTE_IDS` = id yang sudah ada di `ROUTES` App.tsx (`dashboard,links,konten,sosmed,jadwal,logs`); parse = strip leading `#/`, `toLowerCase`, validasi ke ROUTE_IDS.
- [ ] **Step 4:** Test pass (4/4).
- [ ] **Step 5: Wiring App.tsx:** `useState(() => parseHash(location.hash))`; `useEffect` listen `"hashchange"` → `setRoute(parseHash(location.hash))`; `go(id)` set `location.hash = hashFor(id)` (biarkan hashchange yang set state — satu jalur); tutup drawer seperti sekarang. `ROUTES` App mengambil id dari `ROUTE_IDS` (jangan dua sumber truth).
- [ ] **Step 6: Build + smoke browser** (Review Focus 1–2): login → navigasi Logs via klik → assert `location.hash === "#logs"`; reload tab → heading Logs masih ada; ketik `#/nope` → Dashboard; buka drawer mobile (resize 390px), klik Jadwal, tekan back → drawer tertutup + rute Jadwal. Console error = 0.
- [ ] **Step 7: Commit** `git add web/src/lib web/tests web/src/App.tsx public/dist && git commit -m "ui: hash routing (deep-link, back, reload-safe)"`

### Task 2: Skeleton saat cek sesi (hapus layar hitam)

**Files:**
- Modify: `web/src/App.tsx` (blok `if (checking) return null`)

**Interfaces:**
- Consumes: `Skeleton` dari `./components/ui/skeleton` (sudah ada).

- [ ] **Step 1:** Ganti `return null` dengan shell: `div.flex.min-h-screen.bg-zinc-950` berisi aside `w-52` 6× `Skeleton className="h-8"` dan main `Skeleton className="h-6 w-64"` + 3× `h-4 w-full`. (Review Focus 5: path `.catch(() => setUser(null))` sudah ada — pastikan tetap; skeleton hanya saat `checking`.)
- [ ] **Step 2:** `cd web && bun run build` exit 0.
- [ ] **Step 3: Smoke:** throttle devtools tak perlu — hard-reload saat sesi valid, assert skeleton muncul ≤1 frame lalu Dashboard; assert tak ada blank >300ms via `js("document.body.innerText")` cepat setelah goto tanpa cookie → Login (bukan blank).
- [ ] **Step 4: Commit** `ui: skeleton shell saat cek sesi`

### Task 3: Login form — label, autocomplete, target sentuh, kontras, slot error

**Files:**
- Modify: `web/src/routes/Login.tsx`, `web/src/components/ui/button.tsx` (variant `default` saja)

**Interfaces:**
- Produces: `default` variant button = latar `bg-accent` token, teks `text-[#0b0c0e]`.

- [ ] **Step 1:** Tiap input: tambah `id` + `<label htmlFor>` terlihat ( teks: "Nama pengguna", "Kata sandi"), `autocomplete="username"` / `"current-password"`, `min-h-[44px]`. Subtitle "Login operator" → "Masuk operator". Placeholder hapus (label sudah).
- [ ] **Step 2:** Slot error: `div role="alert" aria-live="polite"` kosong→ terisi pesan gagal (state error yang sudah ada, hanya render-kan + merah `text-red-400 text-sm`). Tombol submit: `disabled` saat kosong/submitting + teks "Memuat…" saat loading (state loading sudah ada jika ada; kalau belum, `useState`).
- [ ] **Step 3:** button.tsx default variant: `bg-accent text-[#0b0c0e] hover:bg-accent/90`, ukuran `sm` tingginya naik ke `h-9`→ minimal `min-h-[44px]` untuk form (class per-instance, jangan uba global sm). Font submit 14px (`text-sm`).
- [ ] **Step 4:** Verifikasi computed-style via browser_exec: `button` height ≥44, `fontSize ≥14px`, label count 2, autocomplete benar; salah password → teks error tampil di slot, bukan alert(). Console 0.
- [ ] **Step 5: Commit** `ui: login labels+autocomplete+44px target+accent contrast`

### Task 4: Palet — token `--color-accent` satu sumber

**Files:**
- Modify: `web/src/index.css`, `web/src/App.tsx`, `web/src/routes/{Dashboard,Jadwal,Konten,Links,Login,Sosmed}.tsx`, `web/src/components/ui/badge.tsx` bila hardcoded

**Interfaces:**
- Consumes: `@theme` tokens yang sudah ada (`--color-accent` dst → otomatis `bg-accent/text-accent/border-accent` di Tailwind v4).

- [ ] **Step 1:** Grep baseline: `grep -c "emerald-" web/src/**/*.tsx` (catat N awal, hari ini ≈11 di routes + ui).
- [ ] **Step 2:** Ganti emerald family di routes/App/Badge → token: `text-emerald-200|300`→`text-accent`; `bg-emerald-950/40`→`bg-accent/10`; `border-emerald-700/60`→`border-accent/40`; zinc family BiARKAN (netral, bukan aksesoris brand). `oklch` di index.css: pastikan `--color-accent` dipakai component — kalau token terlalu pastel untuk text di bg gelap, ubah nilai token SEKALI di index.css (mis `#34d399→#4ade80`? tidak — pakai `#7dd3a8` yang ada, kontras ke bg 8.6:1, aman).
- [ ] **Step 3:** `grep -r "emerald-" web/src | grep -v components/ui` → 0. Build exit 0.
- [ ] **Step 4:** Screenshot 3 route (Dashboard/Jadwal/Links) sebelum-vs-sesudah di kanvas yang sama; warna hijau konsisten; kirim MEDIA ke operator sebagai bukti.
- [ ] **Step 5: Commit** `ui: satu token aksen (buang emerald hardcode)`

### Task 5: Baris data Jadwal + Links — grid rata kolom, truncate

**Files:**
- Modify: `web/src/routes/Jadwal.tsx`, `web/src/routes/Links.tsx` (baris list saja; header/toolbar/filter tak berubah)

**Interfaces:**
- Produces: kontrak kelas baris (dipakai kedua file):
  - md+: `grid grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)_minmax(0,.9fr)_auto] items-center gap-2`
  - <md: `flex flex-col gap-1` (sama seperti sekarang)
  - sel teks panjang: `min-w-0` + `truncate` (title atribut = teks penuh).

- [ ] **Step 1:** Jadwal baris: jam (kol1) · link/produk (kol2, truncate) · status badge (kol3) · aksi (kol4 auto). Links baris: produk (kol1 truncate) · url short (kol2 truncate) · status/times (kol3) · aksi. Jangan ubah isi/handler, hanya container kelas + `min-w-0` di pembungkus teks; tombol yang sekarang `ml-auto` dipindah ke sel `justify-self-end`.
- [ ] **Step 2:** Header kolom kecil di atas daftar (md+ only, `hidden md:grid` grid-cols sama, `text-[11px] text-zinc-500`).
- [ ] **Step 3:** Verifikasi browser (Review Focus 3): viewport 390px → baris Links dengan produk terpanjang: `scrollWidth<=clientWidth` tiap sel teks (truncate aktif, tak ada kolom meleber), tinggi baris seragam ±2px; viewport 1280 → `grid-template-columns` resolved bukan `none`. Screenshot 390px Jadwal = bukti kolom rata (bandingkan screenshot lama operator: wrap 3 baris → kini maks 2).
- [ ] **Step 4: Commit** `ui: baris Jadwal+Links pakai grid rata kolom + truncate`

### Task 6: Sticky header daftar + cap 50 ("Muat lebih banyak") — Links, Konten, Logs

**Files:**
- Modify: `web/src/routes/{Links,Konten,Logs}.tsx`

**Interfaces:**
- Consumes: kontrak grid Task 5 (Links) — header sticky pakai kelas grid yang sama.

- [ ] **Step 1:** Tiap file: `const [cap, setCap] = useState(50)`; render `rows.slice(0, cap)`; footer: jika `rows.length > cap` → Button ghost full-width `Muat lebih banyak (sisa {rows.length - cap})`, `setCap(c => c + 50)`. (Review Focus 4: `rows.length === 50` → sisa 0 → tombol hilang — assert ini.)
- [ ] **Step 2:** Header daftar/ kolom (Links/Konten): `sticky top-[52px] md:top-0 z-20 bg-zinc-950/95 backdrop-blur` di baris header luar; Logs header ikut pola yang sama.
- [ ] **Step 3:** Verifikasi: Konten hari ini >50 baris? — kalau DB sekarang < 50, seed test lewat state lokal di browser (set cap sementara via devtools tidak perlu; cukup assert logika di `rows.length` vs cap dengan data yang ada: tombol tak muncul saat semua muat, dan muncul saat cap dipaksa 5 lewat `js` override bukan produk). Minimal: assert DOM tanpa error, scroll 500px header masih di posisi (getBoundingClientRect().top konstan), teks sisa benar.
- [ ] **Step 4: Commit** `ui: sticky list header + muat lebih banyak (cap 50)`

### Task 7: Ritme gap + tutup plan

**Files:**
- Modify: hanya file yang sudah disentuh Task 1–6

- [ ] **Step 1:** Normalisasi dalam file-file itu: antar kartu/section `gap-4`, dalam kartu `gap-2`, chip/badge `gap-1`. Buang `gap-3` campuran di jalur tersebut. `text-[9px]`→`text-[10px]` di baris data (4 kemunculan).
- [ ] **Step 2:** `cd web && bun run build` && `node --experimental-strip-types --test web/tests/routing.test.ts` → pass.
- [ ] **Step 3: Smoke penuh** semua 6 route (click-through), mobile 390 + desktop 1280, console 0 error; screenshot Dashboard+Jadwal+Links dikirim MEDIA.
- [ ] **Step 4:** `git add public/dist && git commit -m "ui: gap rhythm; rebuild dist"` → `bash /root/.hermes/cache/scratch/pushclean.sh` (tree 0, PARITY OK, SECRET-SCAN BERSIH) → `git push`.

---

## Verifikasi akhir plan (semua wajib fresh)

- `bun run build` exit 0; routing test 4/4 pass.
- Browser: deep-link reload, back button, skeleton, grid 390px, sticky, cap — per Review Focus.
- Journal server tak boleh error bertambah; scheduler cron 11:30/18:50 dst tidak tersentuh (UI statis only).
- pushclean pattern: tree 0 + HEAD==origin/main + secret 0 hits.
