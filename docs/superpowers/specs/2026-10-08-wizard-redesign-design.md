# Wizard Pipeline — Operator One-Screen Redesign (AffiSocAI)

**Date:** 2026-10-08
**Status:** Approved design — implementation
**Owner:** LTX-QUASAR (default profile)

## 1. Problem

Operator AffiSocAI bekerja lewat 6 halaman terpisah (`#/links`, `#/konten`, `#/sosmed`, `#/jadwal`, `#/dashboard`, `#/logs`). Alur produktif (link Shopee → gambar → caption → terbit) tersebar antar-halaman, memaksa context-switch dan operasi manual. Tidak ada satu tempat untuk melihat status provider/scheduler saat bekerja (provider mati senyap tanpa badge). Struktur frontend menabrak paralel worker (hotspot route files) dan tidak ada satu lintasan pipeline utuh.

## 2. Goals / Non-Goals

**Goals:**
- Satu lintasan pipeline 1-layar: paste link → auto-enrich → gambar AI → smart caption → review → jadwalkan/terbit.
- Status always-visible: provider, scheduler health, slot hari ini, live event.
- Nol perubahan backend (`server.ts`), nol perubahan schema DB. Semua lewat endpoint existing.
- Tabrakan edit paralel frontend hilang: wizard + rail dalam folder terisolasi, tidak menyentuh file route lain.

**Non-Goals (fase selanjutnya):**
- Split `server.ts` → fase sauatu
- systemd unit / watchdog / secret hygiene → fase terpisah
- Perubahan schema DB → tidak ada
- Rombak total framework/wiring state → tidak ada

## 3. Architecture

```
web/src/
  routes/wizard/          ← NEW: PipelineWizard + step components (domain 1-layar)
  rail/                   ← NEW: StatusRail.tsx + useRailPolling.ts + useLogStream.ts
  lib/routing.ts          ← + "wizard" → ROUTE_IDS (drift-free via NAV)
  components/nav-items.ts ← + wizard label/icon
  App.tsx                 ← + render Wizard when route==="wizard", + <StatusRail/> mount
  components/ui/          ← reuse existing primitives (Button, Card, Dialog, Skeleton, Spinner, Toast, Confirm)
```

- **ROUTE_IDS** single source: `lib/routing.ts` adds `"wizard"`, `nav-items.ts` maps label/Icon — zero drift.
- **Wizard** is a state machine (pure function, unit-testable) with sessionStorage persistence per link-id.
- **StatusRail** polls `/api/providers`, `/api/schedule/health`, `/api/schedule`, and opens SSE `/api/logs/stream`. Poll 60s + SSE live log.
- Server: **zero touch**. Uses existing endpoints listed in §5.

## 4. Endpoints consumed (existing)

| Step | Endpoint |
|---|---|
| 1 | `POST /api/links` (create), `POST /api/links/:id/enrich` |
| 2 | `POST /api/links/:id/recreate-image`, `GET /api/links/:id/recreate-image/status` |
| 3 | `POST /api/content/generate` (or `/api/content/mystery`) |
| 4 | `POST /api/links/:id/post`, `GET /api/schedule`, `POST /api/schedule/config` |
| Rail | `GET /api/providers`, `GET /api/schedule/health`, `GET /api/schedule`, SSE `GET /api/logs/stream` |

## 5. Wizard Spec (state machine)

**Steps:** `link → image → caption → publish`. Progress stepper vertical left, preview card right (IG-style post: image + caption + CTA).

- **Step 1 (Rekat):** textarea paste Shopee URL → `POST /api/links` → `POST /api/links/:id/enrich` → show enriched product card. On fail: manual fields (product, price, image_url) with fallback, no blocker.
- **Step 2 (Gambar):** if no image or re-generate requested → `POST /api/links/:id/recreate-image`; poll `/api/links/:id/recreate-image/status` until `approved`/`rejected`/`failed`; auto-regen ≤2x on REJECT (STRICT REDRAW directive). On infra-fail → fallback original photo.
- **Step 3 (Caption):** `POST /api/content/generate` → smart caption (AI-first, validator keras). Inline edit. Show validation result (no brand spill, no link/hashtag/price claim, cap 460).
- **Step 4 (Terbit):** pick platforms (IG/FB/Threads) + slot (now or scheduled time). `POST /api/links/:id/post` or `POST /api/schedule/config`.

**Persistence:** sessionStorage key `affisocai.wizard.<linkId>` — reload safe, done link cleans key.

## 6. Status Rail Spec

- **Placement:** sticky right rail on `md+`, drawer/hamburger on mobile (reuse drawer pattern from App).
- **Sections:**
  - **Providers:** name, connected bool, error → `GET /api/providers`.
  - **Scheduler:** status dot (health), today slots pending/claimed/published/failed → `GET /api/schedule/health` + `GET /api/schedule`.
  - **Live events:** tail-100 from SSE `/api/logs/stream`; badge unread count.
- **Polling:** providers+schedule every 60s; logs via SSE (auto-reconnect). Rail offline = gray badge, never crash host.
- **Actions:** click provider → navigate `#/sosmed`; click failed slot → navigate `#/jadwal`; click "Wizard" → `#/wizard`.

## 7. Error handling & Testing

- **Wizard:** per-step failure → inline error + fallback manual field; state persists; reload safe.
- **Rail:** fetch failure → gray badge + retry backoff, no crash.
- **Tests** (new, follow existing pattern in `web/tests/`):
  - `wizard-flow.test.ts` — state machine transitions (pure fn), validation of steps.
  - `routing.test.ts` — extend: `#/wizard` resolves, invalid hash falls back to dashboard.
- **Typecheck fix (required gate):** `npm run typecheck` currently fails (tsc invocation error). Fix tsconfig so build gate is green before shipping. Verify `web` different from root typecheck.

## 8. Verification

1. `cd web && npm run typecheck` green.
2. `cd web && npm test` green (all tests incl. new wizard tests).
3. `npm run build` (vite) produces `public/dist/` without error.
4. `curl /api/session` → 200 logged_out shape; `curl /api/providers` → 200 (or 401 as expected).
5. Live server: `#/wizard` renders, stepper advances, step 1 creates link from a real Shopee URL, rail shows providers + scheduler status, SSE logs stream.
6. No server restart needed (frontend only) — server already running PID 1290.

## 9. Risks

- Enrich/recreate-image depend on external router (realpaytrans) — if router down, wizard must degrade gracefully (manual fallback) — already designed.
- SSE reconnect storms — bounded reconnect with backoff.
- Wizard + rail grow — keep each file ≤250 lines (project rule), split step components.
