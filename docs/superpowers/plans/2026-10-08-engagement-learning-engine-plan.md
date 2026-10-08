# Content Intelligence & Engagement Learning Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mengintegrasikan nomor produk bio (`sheet_id`), Google Trends ID ke caption, mengaktifkan penarikan metrik Threads, dan membangun `engagement-engine.ts` yang mempelajari hook/caption pemenang untuk memaksimalkan views, likes, dan comments secara otomatis.

**Architecture:** 
1. Memperluas caption builder (`mystery-caption.ts` dan `smart-caption.ts`) untuk mendukung `sheet_id` (nomor urut bio) dan dynamic trending hashtags.
2. Memperbaiki `analytics.ts` dan `store.ts` agar mengambil metrik Threads secara rutin bersama IG dan FB.
3. Membangun modul baru `engagement-engine.ts` yang menghitung skor Bayesian Engagement Score (ES) dan menyediakan pola pemenang (few-shot prompting) ke generator AI.
4. Menghubungkan seluruh feedback loop di `scheduler.ts` dan menyediakan endpoint status insight di server API.

**Tech Stack:** TypeScript, Node.js v26, SQLite (node:sqlite `DatabaseSync`), React 19 / Vite frontend.

**Spec:** `docs/superpowers/specs/2026-10-08-engagement-learning-engine-design.md`

## Global Constraints
- Target repo: `/root/affiliate-tools`
- Jangan menyentuh atau memodifikasi profile `bozagentic`
- Seluruh klaim hasil harus lolos unit test (`node --test`)
- Keamanan: Jangan sertakan token/kredensial eksplisit

---

## Task 1: Caption Enrichment (Nomor Urut Bio & Trending Hashtags)

**Files:**
- Modify: `src/core/mystery-caption.ts`
- Modify: `src/core/smart-caption.ts`
- Create: `tests/caption-enrichment.test.ts`

**Interfaces:**
- Consumes: `cachedTrends` from `src/core/trends.ts`, `sheet_id` from `LinkInfo`.
- Produces: `buildMysteryCaption(..., { sheet_id })`, `composeSmartBody(story, platform, type, sheet_id, trendTags)`.

- [x] **Step 1: Write failing unit test `tests/caption-enrichment.test.ts`**
  Menguji bahwa jika `sheet_id` ada (misal `12`), bio line menjadi `Cek no. 12 di link bio ya!` pada IG dan FB, serta hashtag tren disematkan jika tersedia tanpa melebihi batas karakter.

- [x] **Step 2: Run test to verify it fails**
  Run: `cd /root/affiliate-tools && node --test tests/caption-enrichment.test.ts`
  Expected: FAIL (fitur belum diimplementasikan).

- [x] **Step 3: Implement caption enrichment in `mystery-caption.ts` & `smart-caption.ts`**
  Tambahkan parsing `sheet_id` untuk bio line dinamis dan masukkan tag dari `cachedTrends(2)` untuk Instagram dan Facebook.

- [x] **Step 4: Run test to verify it passes**
  Run: `cd /root/affiliate-tools && node --test tests/caption-enrichment.test.ts`
  Expected: PASS.

- [x] **Step 5: Commit**
  ```bash
  git add src/core/mystery-caption.ts src/core/smart-caption.ts tests/caption-enrichment.test.ts
  git commit -m "feat(caption): add bio product number & trend hashtags"
  ```

---

## Task 2: Complete Analytics Pulling for Threads, IG, & FB

**Files:**
- Modify: `src/core/analytics.ts`
- Modify: `src/core/store.ts`
- Create: `tests/analytics-pull.test.ts`

**Interfaces:**
- Consumes: `getProvider(c.platform).getAnalytics(c.post_id)`
- Produces: `staleMetricsContentIds(ageHours, limit)` yang mencakup platform `threads`.

- [x] **Step 1: Write failing unit test `tests/analytics-pull.test.ts`**
  Memverifikasi bahwa `staleMetricsContentIds` mengembalikan content id untuk Threads yang belum ditarik metriknya.

- [x] **Step 2: Run test to verify it fails**
  Run: `cd /root/affiliate-tools && node --test tests/analytics-pull.test.ts`
  Expected: FAIL.

- [x] **Step 3: Implement unified metrics pulling in `analytics.ts` and query update in `store.ts`**
  Pastikan Threads di-query dan metrik insight di-upsert ke `post_metrics`.

- [x] **Step 4: Run test to verify it passes**
  Run: `cd /root/affiliate-tools && node --test tests/analytics-pull.test.ts`
  Expected: PASS.

- [x] **Step 5: Commit**
  ```bash
  git add src/core/analytics.ts src/core/store.ts tests/analytics-pull.test.ts
  git commit -m "feat(analytics): enable unified metrics collection for Threads, IG, FB"
  ```

---

## Task 3: Engagement Learning Engine

**Files:**
- Create: `src/core/engagement-engine.ts`
- Create: `tests/engagement-engine.test.ts`
- Modify: `src/core/hook-perf.ts`

**Interfaces:**
- Consumes: `post_metrics`, `content`, `links` dari SQLite.
- Produces: `calculateEngagementScore(metrics)`, `aggregateEngagementPatterns()`, `getFewShotExamples(type)`, `selectPattern(type, rand)` (epsilon-greedy: 80% exploit pola pemenang, 20% explore variasi baru).

- [x] **Step 1: Write failing unit test `tests/engagement-engine.test.ts`**
  Menguji formula kalkulasi skor ($Views + 3(Likes+Saves) + 5(Comments/Replies) + 7(Shares/Reposts)$), perankingan pola hook AI pemenang, perilaku epsilon-greedy (`selectPattern`), dan toleransi saat data metrik masih sedikit (cold start).

- [x] **Step 2: Run test to verify it fails**
  Run: `cd /root/affiliate-tools && node --test tests/engagement-engine.test.ts`
  Expected: FAIL.

- [x] **Step 3: Implement `engagement-engine.ts`**
  Buat fungsi ekstraksi hook pembuka, penghitung skor terbobot, penyimpanan pola pemenang per kategori, dan format few-shot prompt.

- [x] **Step 4: Run test to verify it passes**
  Run: `cd /root/affiliate-tools && node --test tests/engagement-engine.test.ts`
  Expected: PASS.

- [x] **Step 5: Commit**
  ```bash
  git add src/core/engagement-engine.ts src/core/hook-perf.ts tests/engagement-engine.test.ts
  git commit -m "feat(engine): add engagement learning engine & few-shot feedback"
  ```

---

## Task 4: In-Context Learning Injection & Scheduler Integration

**Files:**
- Modify: `src/core/smart-caption.ts`
- Modify: `src/core/scheduler.ts`
- Modify: `src/api/server.ts`

**Interfaces:**
- Consumes: `getFewShotExamples` from `engagement-engine.ts`
- Produces: AI prompt yang diperkaya contoh hook berkinerja tinggi, scheduler yang menjalankan agregasi harian, dan endpoint `/api/engagement/insights`.

- [x] **Step 1: Wire `smart-caption.ts` to include few-shot examples in LLM prompt**
  Suntikkan contoh hook terbaik dari `engagement-engine.ts` ke dalam variabel `user` prompt AI.

- [x] **Step 2: Connect learning loop in `scheduler.ts`**
  Panggil pembaruan pola engagement secara berkala saat scheduler tick dan teruskan `sheet_id` link ke pembuatan draft.

- [x] **Step 3: Expose `/api/engagement/insights` endpoint in `server.ts`**
  Endpoint untuk menampilkan hook-hook terbaik dan statistik performa ke UI.

- [x] **Step 4: Execute entire test suite**
  Run: `cd /root/affiliate-tools && npm test`
  Expected: All tests PASS.

- [x] **Step 5: Commit**
  ```bash
  git add src/core/smart-caption.ts src/core/scheduler.ts src/api/server.ts
  git commit -m "feat(scheduler): integrate engagement learning feedback loop & insights API"
  ```
