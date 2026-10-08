# Content Intelligence & Engagement Learning Engine Spec

> **Status:** APPROVED (in brainstorming session 2026-10-08)  
> **Target:** `/root/affiliate-tools`  
> **Authors:** LTX-QUASAR & opan  
> **Branch / Git:** Current main (`8611fd4`)  

---

## 1. Context & Business Intent

Aplikasi AffiSocAI saat ini mengotomatisasi publikasi konten affiliate Shopee ke 3 platform utama: **Instagram**, **Facebook**, dan **Threads**.
Meskipun infrastruktur posting dan Wizard sudah berjalan mulus, performa audiens (views, likes, comments) masih rendah dan belum ada mekanisme adaptif cerdas untuk mengoptimalkannya.

Terdapat 3 gap besar di sistem saat ini:
1. **Feedback Loop Terputus / Parsial:**
   - Tabel `post_metrics` sudah ada tapi hanya diisi oleh Instagram dan Facebook. Threads metrics (`views, likes, replies, reposts, quotes`) sudah diimplementasikan di `src/providers/threads.ts` tetapi **belum dipanggil** di `analytics.ts` loop.
   - Modul `hook-perf.ts` hanya memilih template hook statis (`HOOKS[type]`), tidak pernah menilai teks variasi AI (`smartCaption`). Caption yang viral atau gagal tidak memiliki rekam jejak.
2. **Ketiadaan Nomor Produk di Bio:**
   - Database `links` memiliki 34 entri di mana 33 di antaranya memiliki relasi `sheet_id` (nomor urut di biolink Karasu-Michi).
   - Namun caption Instagram & Facebook hanya menulis *"Link di bio"*, tanpa menyebutkan nomor produk (contoh: *"Cek nomor 4 di link bio"*). Ini meningkatkan friksi audiens saat mencari link di halaman bio.
3. **Infrastruktur Tren Tidak Digunakan (Newsjacking Mati):**
   - Modul `src/core/trends.ts` sudah siap menarik Google Trends ID RSS real-time secara aman (dengan blocklist tragedi/kematian).
   - Tetapi fungsi `cachedTrends()` tidak pernah disuntikkan ke caption builder atau hashtag generator.

---

## 2. Requirements & Success Criteria

1. **Nomor Produk Bio:**
   - Jika `sheet_id` ada, caption Instagram & Facebook menyertakan petunjuk nomor: *"Cek no. [sheet_id] di link bio"*.
   - Threads tetap fokus pada short link langsung di badan/footer post atau *"Link di bio"*.
2. **Dynamic Trend Hashtags:**
   - Tag hasil `cachedTrends(2)` disematkan sebagai hashtag sekunder di Instagram & Facebook bersama tag kategori produk, memperluas jangkauan organik explore feed.
3. **Complete Metrics Ingestion (IG, FB, Threads):**
   - `analytics.ts` mengonsumsi metrik dari ketiga platform (IG, FB, dan Threads).
   - Metrik Threads diparsing ke dalam bentuk seragam `{ views, likes, replies, reposts }`.
4. **Autonomous Engagement Engine (`engagement-engine.ts`):**
   - Menghitung **Engagement Score (ES)**:
     $$\text{ES} = \text{Views} + 3 \times (\text{Likes} + \text{Saves}) + 5 \times \text{Comments/Replies} + 7 \times \text{Shares/Reposts}$$
   - Menyimpan Top Winners (Hook + CTA + Angle) per tipe produk.
   - Menyediakan In-Context Examples (Few-Shot Prompting) ke `smartCaption` sehingga AI meniru gaya hook yang terbukti menghasilkan interaksi tinggi.
5. **Auto-Rotate Experimentation:**
   - Sistem melakukan eksplorasi otomatis (Epsilon-Greedy / Bandit sederhana: 80% gunakan pola pemenang, 20% variasi baru).
   - Operator dapat melihat status learning dan pemenang melalui endpoint `/api/engagement/insights` dan Status Rail.

---

## 3. Architecture & Data Flow

```
[Platform APIs: IG, FB, Threads]
       │
       ▼ (Hourly Pull / Batch <= 6)
[src/core/analytics.ts] ───> [DB: post_metrics]
                                   │
                                   ▼ (Daily / On-Demand Aggregate)
                         [src/core/engagement-engine.ts]
                                   │
       ┌───────────────────────────┴───────────────────────────┐
       ▼                                                       ▼
[Top Patterns & Few-Shot Cache]                    [Epsilon-Greedy Selector]
       │                                                       │
       ▼                                                       ▼
[src/core/smart-caption.ts]                        [src/core/product-hook.ts]
 (Injected Top Hooks & Formats)                     (Exploration vs Exploitation)
       │                                                       │
       └───────────────────────────┬───────────────────────────┘
                                   │
                                   ▼
                       [src/core/scheduler.ts]
                         + nomor_urut bio
                         + Google Trends tag
                                   │
                                   ▼
                       [Published Content Rows]
```

---

## 4. Detailed Component Design

### 4.1 Bio Number & Trend Ingestion
- File: `src/core/mystery-caption.ts` & `src/core/smart-caption.ts`
- Parameter link diperkaya dengan `sheet_id: number | null`.
- Format Bio Line:
  - Default: `Cek rekomendasi lengkapnya di link bio ya!`
  - Dengan `sheet_id`: `Cek produk No. ${sheet_id} di link bio ya!`
- Trend Tags:
  - Diambil dari `cachedTrends(2)`. Tag yang valid digabungkan ke `hashtags` untuk platform Instagram & Facebook.

### 4.2 Unified Analytics Puller
- File: `src/core/analytics.ts`
- Perbaikan: `staleMetricsContentIds` mencakup baris platform `threads` yang memiliki `post_id`.
- `pullMetricsBatch()` mengeksekusi `p.getAnalytics(c.post_id)` untuk Threads dan meng-upsert ke `post_metrics`.

### 4.3 Engagement Engine (`src/core/engagement-engine.ts`)
- Menganalisis korelasi antara opening sentence (hook), panjang caption, CTA, dan engagement score.
- Output interface:
  ```ts
  export type EngagementPattern = {
    type: string;
    topHooks: Array<{ text: string; score: number; sampleSize: number }>;
    bestPostingHours: number[];
  };
  export function getTopHooksForType(type: string, limit?: number): string[];
  export function calculatePostScore(metrics: Record<string, number>): number;
  export function refreshEngagementPatterns(): Promise<void>;
  ```

### 4.4 Prompt Evolution (`src/core/smart-caption.ts`)
- Saat memanggil LLM router, tambahkan section referensi:
  ```
  Contoh hook yang terbukti disukai audiens untuk produk ini:
  - [Hook A]
  - [Hook B]
  Gunakan gaya/irama yang serupa tapi buat teks yang orisinal.
  ```

---

## 5. Testing & Verification Plan

1. **Unit Tests:**
   - `tests/engagement-engine.test.ts`: verifikasi perhitungan skor formula, pemeringkatan hook, dan agregasi data kosong (cold-start).
   - `tests/caption-enrichment.test.ts`: verifikasi bahwa `sheet_id` disuntikkan ke format caption bio, dan tren hashtag tidak merusak budget karakter Threads / IG.
2. **Integration Verification:**
   - Uji jalan script `analytics.ts` secara offline dengan mock metrics.
   - Verifikasi generate `smartCaption` dengan few-shot injection.
3. **Build & Typecheck:**
   - `npm test` & `npm run build` di `/root/affiliate-tools` dan `/root/affiliate-tools/web`.
