# AffiSocAI UI Overhaul — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: execute inline with superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the operator UI into a coherent design system (tokens, spacing, type scale, components) and split the oversized route files into focused modules WITHOUT changing any API behavior.

**Architecture:** Design tokens live in `index.css` (`@theme`) and drive Tailwind v4 utilities; shared presentational components in `components/ui/`; each route file keeps ONLY orchestration and delegates heavy UI chunks (forms, row lists, previews) to `components/<route>/` modules with typed props. Data layer (`api()` in lib/utils, endpoints, hash routing) untouched.

**Tech Stack:** Vite + React 19 + Tailwind v4 (@theme) + shadcn-style primitives + lucide-react. Build: `cd web && npm run build` → `public/dist`.

## Global Constraints
- Dark-only (existing QA decision); no light mode.
- No new npm dependency.
- Every route keeps the same fetch endpoints, request/response shapes, and behavior. "Tidak merusak fitur" = endpoint calls + user flows byte-equivalent; UI structure may change.
- Mobile (Chrome Android) first-class: no `window.prompt/confirm`, touch targets ≥44px.
- Indonesian copy stays Indonesian; technical terms OK.
- Per task: `npm run build` exit 0 + `node --experimental-strip-types --test web/tests/*.test.ts` + live smoke via browser (mint session per references/uiux-review.md, never print cookie) + one commit.
- Files after split must be < 250 lines each.

## Review Focus
1. Route behavior after split: adding link (bulk/blob), dry-run, preview modal, image preview, bulk actions in Links — each control still hits the same endpoint and shows the same success/failure feedback.
2. Jadwal lease/publish manual + slot edit still functional after component extraction.
3. Sosmed provider connect/flow-status/recreate buttons unchanged; loading states never orphan a busy flag.
4. Toast/error surfaces: previously silent failures stay silent-free; a failed fetch must still render inline error, not just console.
5. Hash routing survives every new component (no local `useState` route duplication reintroduced).

---

### Task 1: Design token system
**Files:** Modify `web/src/index.css`; sweep utilities in `web/src/**` (mechanical, per class map below).
**Interfaces:** Produces CSS vars consumed as Tailwind utilities: `bg-surface`, `text-muted`, `border-line`, `bg-elev`, `ring-accent`, `text-accent`, size tokens `h-11` (touch), `gap-4` rhythm.
- [ ] Step 1: extend `@theme` — `--color-surface` (#101114 panel bg), `--color-elev` (#1a1c21 cards/inputs), `--color-line` (#282b33), `--color-muted` (#9aa0aa), `--color-accent` keep #7dd3a8, add `--color-accent-dim` (#3f6f56); add `--radius-card: 14px`, `--shadow-panel`.
- [ ] Step 2: base layer: `body{background:radial-gradient(1200px 700px at 80% -10%,#131519,#0b0c0e)}`; `*:focus-visible{outline:2px solid var(--color-accent)}`; `::-webkit-scrollbar` 10px/line color; `kbd`/mono `.num{font-variant-numeric:tabular-nums}`.
- [ ] Step 3: mechanical sweep map: `zinc-950→bg` handled by body (remove page-level bg where redundant), `zinc-900→surface`, `zinc-800→line` (borders) / `elev` (fills), `zinc-500/600→muted`, `text-black→[#0b0c0e]`. `grep -rn "zinc-9" web/src | wc -l` → 0 after sweep except intentionally-mapped spots.
- [ ] Step 4: build + routing test + smoke. Commit `feat(ui): design token system`.

### Task 2: Shared primitives
**Files:** Create `components/ui/field.tsx` (label+control+error/hint), `components/ui/empty.tsx` (icon+title+desc+action), `components/ui/toast.tsx` (`useToast()` hook + `<Toasts/>` singleton mounted once in AppShell; auto-dismiss 4s, aria-live), `components/ui/confirm.tsx` (modal confirm — promise-based `confirmDlg({title,body,danger})`, replaces `window.confirm`).
**Interfaces:** `useToast(): {toast(msg,kind?)} ` ; `confirmDlg(opts): Promise<boolean>`; `Field({label,hint,error,children})`.
- [ ] Step 1: write `web/tests/ui-primitives.test.ts` — pure-logic tests for toast queue reducer + confirm promise resolve/reject (export logic from components, render-independent). Run → FAIL.
- [ ] Step 2: implement 4 components (toast state module `lib/toast-store.ts` for testability). Tests → PASS.
- [ ] Step 3: grep routes for `window.confirm|alert(`; replace with confirmDlg/toast (Links bulk delete, Sosmed actions). Build. Commit `feat(ui): shared primitives`.

### Task 3: Split Links.tsx (526 → ≤4 files)
**Files:** Create `components/links/AddLinkForm.tsx` (blob textarea, kategori, dry-run, submit; props `onAdded(links)`), `components/links/LinkList.tsx` (search/sort/cap/select/row rendering incl. badges link hidup/mati), `components/links/PreviewDialogs.tsx` (bulk caption preview + image preview); Modify `routes/Links.tsx` to orchestration ≤150 lines.
**Interfaces:** each uses `api()` from lib/utils directly; props only for parent callbacks.
- [ ] Step 1: move code mechanically (no logic edit); fix imports/types; build exit 0.
- [ ] Step 2: behavior checklist vs current bundle: GET /api/links, POST /api/links (dryRun + real), bulk preview endpoint, per-row recreate/enrich endpoints — verify buttons still call same paths (grep endpoint strings old vs new file set: `grep -rho '"/api/[a-z/:._-]*"' src oldbackup` equal set).
- [ ] Step 3: browser smoke desktop+390px: add-link form, dry-run output, preview modal open/close, image preview, cap/load-more. Commit `refactor(ui): split Links route`.

### Task 4: Split Jadwal.tsx (520)
**Files:** Create `components/jadwal/SlotRow.tsx` + `components/jadwal/EditSlotsDialog.tsx`; Modify `routes/Jadwal.tsx`.
- [ ] Step 1-2: as Task 3 method (mechanical split, endpoint-set equality grep, smoke: slot list, manual publish button, edit times dialog, status badges). Commit `refactor(ui): split Jadwal route`.

### Task 5: Split Sosmed.tsx + Konten.tsx
**Files:** Create `components/sosmed/ProviderCard.tsx`, `components/sosmed/ThreadsPanel.tsx` (oauth/relogin + reply toggle + flow status), `components/konten/ContentRow.tsx`; Modify routes to orchestration.
- [ ] Step 1: mechanical split; build; endpoint-set equality.
- [ ] Step 2: smoke: providers status renders VERIFIED tags, authorize link present, Konten list + per-row actions. Commit `refactor(ui): split Sosmed+Konten`.

### Task 6: Dashboard + AppShell polish
**Files:** Modify `routes/Dashboard.tsx` (stat cards row: links alive, published hari ini, metrics terkumpul, reply auto — small GET-only aggregates from existing endpoints), `App.tsx` (mount `<Toasts/>`; brand block: logo mark 24px square accent→"A", nav active gets left bar; main padding rhythm via tokens).
- [ ] Step 1: dashboard stat cards (data already client-side: links[], sched.body.status.today, metrics[]; NO new endpoint).
- [ ] Step 2: nav active state: `border-l-2 border-accent pl-2` + aria-current="page".
- [ ] Step 3: build + smoke both viewports + routing tests. Commit `feat(ui): dashboard stats + shell polish`.

### Task 7: Final gate
- [ ] Full build; `wc -l` all new files <250; routing test; browser crawl every route desktop+mobile screenshots; server boot 200; journal 0 error; push clean (tree 0, HEAD=origin, `.env` untracked, secret grep 0); update skill affiliate-tools-ops (frontend section: new component map + toast/confirm pattern).
