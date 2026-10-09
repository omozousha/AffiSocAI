/**
 * Posting scheduler — 3 slots a day, run in-process.
 *
 * One slot = one product posted to EVERY publishable platform (instagram,
 * facebook, threads). Each platform gets its own caption draft + content row,
 * so a failure on one platform never blocks the others.
 *
 * The scheduler is NOT a separate process. It is a tick loop started by the
 * server (startScheduler at boot) that walks the queue and publishes any slot
 * whose time has come. Running in-process means it shares the same DB, the
 * same provider sessions, and the same log as the rest of the app, and dies
 * when the app dies — no orphaned poster.
 *
 * Invariants:
 *   1. One publish per slot per day, enforced by a UNIQUE index on
 *      (slot_date, slot_index). A slot can never be posted twice.
 *   2. Publish happens through the provider registry only.
 *   3. A slot claimed by a dead process is reclaimed after the lease expires
 *      (the process could have died between claim and commit).
 *   4. A captioned slot needs an image, or it is skipped and left as failed —
 *      a post without media is worse than no post.
 *   5. Nothing here asks permission or blocks on a user. Every tick is
 *      time-driven and self-reported.
 */

import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { listLinks, getLink, addContent, listContent, setContentStatus, syncLinkMarkers, metricsWithPostTime } from "./store.ts";
import { buildIdentity, detectType } from "./product-identity.ts";
import { imagePromptFor, setHookPerf } from "./product-hook.ts";
import { aggregatePerf, HOOK_PERF_KEY } from "./hook-perf.ts";
import { getTopHooksForPrompt, chooseFewShotHooks, type RankedHook, DEFAULT_WEIGHTS, tuneEngagementWeights, calculateEngagementScore, type EngagementWeights } from "./engagement-engine.ts";
import { buildMysteryCaption, MYSTERY_PLATFORMS, topicFor } from "./mystery-caption.ts";
import { fetchTopTrends, cachedTrends } from "./trends.ts";
import { smartCaption, composeSmartBody } from "./smart-caption.ts";
import { listProviders, getProvider } from "./registry.ts";
import { logActivity } from "./activity-log.ts";
import type { SocialContent, SocialProvider } from "./types.ts";
import type { MysteryDraft } from "./mystery-caption.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.AFFILIATE_DB || join(HERE, "..", "..", "data", "affiliate.db");

export type SlotStatus = "pending" | "claimed" | "published" | "failed" | "skipped";
export type PlatformKey = MysteryDraft["platform"];

export type SlotRow = {
  id: number;
  slot_date: string;
  slot_index: number;
  scheduled_for: string;
  status: SlotStatus;
  link_id: number | null;
  platform: string | null;
  content_id: number | null;
  post_id: string | null;
  post_url: string | null;
  error: string | null;
  attempts: number;
  /** Process that claimed this slot, so a zombie can be told apart. */
  lease_owner: string | null;
  lease_until: string | null;
  /** Pre-warm: creative ready before due time (link locked, image built). */
  warmed_link_id: number | null;
  warmed_media_url: string | null;
  warmed_at: string | null;
  created_at: string;
};

mkdirSync(dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS post_slots (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    slot_date      TEXT    NOT NULL,
    slot_index     INTEGER NOT NULL,
    scheduled_for  TEXT    NOT NULL,              -- UTC "YYYY-MM-DD HH:MM:SS"
    status         TEXT    NOT NULL DEFAULT 'pending',
    link_id        INTEGER,
    platform       TEXT,
    content_id     INTEGER,
    post_id        TEXT,
    post_url       TEXT,
    error          TEXT,
    attempts       INTEGER NOT NULL DEFAULT 0,
    lease_owner    TEXT,
    lease_until    TEXT,
    warmed_link_id INTEGER,
    warmed_media_url TEXT,
    warmed_at      TEXT,
    created_at     TEXT    NOT NULL DEFAULT (datetime('now', 'subsec')),
    UNIQUE (slot_date, slot_index)
  );
  CREATE INDEX IF NOT EXISTS idx_slots_due ON post_slots(status, scheduled_for);
  CREATE TABLE IF NOT EXISTS scheduler_meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// Migration for DBs born before pre-warm columns existed.
{
  const cols = db.prepare(`PRAGMA table_info(post_slots)`).all() as Array<{ name: string }>;
  for (const [col, ddl] of [["warmed_link_id", "INTEGER"], ["warmed_media_url", "TEXT"], ["warmed_at", "TEXT"]] as const) {
    if (!cols.some((c) => c.name === col)) db.exec(`ALTER TABLE post_slots ADD COLUMN ${col} ${ddl}`);
  }
}

/** Local-time HH:MM -> slot index. Default: morning scroll / lunch / evening prime (WIB). */
export const DEFAULT_SLOT_TIMES = ["07:30", "12:30", "19:30"] as const;

function metaGet(key: string): string | null {
  const row = db.prepare(`SELECT value FROM scheduler_meta WHERE key = ?`).get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

function metaSet(key: string, value: string): void {
  db.prepare(
    `INSERT INTO scheduler_meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(key, value);
}

/**
 * P2.7 — daily aggregate of post_metrics into per-hook stats, then push the
 * JSON into product-hook's cache so pickHook can favor proven winners.
 * Rolling 30-day window; runs at most once per day (meta-gated like the
 * health sweep). Cold DB / no metrics => cache stays null => old rotation.
 */
function refreshHookPerf(now: Date): void {
  const last = metaGet("hook_perf_last") ?? "";
  if (last.slice(0, 10) === dayKey(now)) return;
  const rows = db
    .prepare(
      `SELECT c.body b, m.metrics m, l.product p, l.kategori k
       FROM post_metrics m JOIN content c ON c.id = m.content_id
       LEFT JOIN links l ON l.id = c.link_id
       WHERE c.status = 'published' AND c.created_at > datetime('now','-30 days')`,
    )
    .all() as unknown as { b: string; m: string; p: string | null; k: string | null }[];
  const perf = aggregatePerf(rows);
  metaSet(HOOK_PERF_KEY, JSON.stringify(perf));
  metaSet("hook_perf_last", now.toISOString());
  setHookPerf(JSON.stringify(perf));
  const types = Object.keys(perf).length;
  if (types > 0) logActivity({ level: "info", source: "system", event: "hook.perf", message: `aggregated ${rows.length} metric posts into ${types} type buckets` });
}

/**
 * Engagement Learning Engine — daily refresh.
 *
 * The old refreshHookPerf above only fed product-hook's static template
 * variants (score = reach + 2*engagement, no weights). This one aggregates the
 * SAME post_metrics rows with the weighted ES formula and publishes the top
 * hooks so smart-caption.ts can inject them as few-shot examples. Both run
 * side by side: templates keep rotating, AI captions get real signal.
 */
function refreshEngagementPerf(now: Date): void {
  const last = metaGet("engagement_perf_last") ?? "";
  if (last.slice(0, 10) === dayKey(now)) return;
  const rows = db
    .prepare(
      `SELECT c.body b, m.metrics m, l.product p, l.kategori k
       FROM post_metrics m JOIN content c ON c.id = m.content_id
       LEFT JOIN links l ON l.id = c.link_id
       WHERE c.status = 'published' AND c.created_at > datetime('now','-30 days')`,
    )
    .all() as unknown as { b: string; m: string; p: string | null; k: string | null }[];
  const metricRows = rows.map((r) => ({
    body: r.b,
    metrics_json: r.m,
    product: r.p,
    kategori: r.k,
  }));
  const top = getTopHooksForPrompt(metricRows, 5);
  metaSet("engagement_perf", JSON.stringify(top));
  metaSet("engagement_perf_last", now.toISOString());
  if (top.length > 0) {
    logActivity({
      level: "info",
      source: "system",
      event: "engagement.learn",
      message: `top hooks: ${top.slice(0, 3).map((h: RankedHook) => h.hook.slice(0, 28)).join(" | ")}`,
      meta: { top: top.length, rows: rows.length },
    });
  }
}

/** Top hooks for smart-caption few-shot injection (null = no signal yet). */
export function engagementTopHooks(): { hook: string; score: number; posts: number }[] | null {
  const raw = metaGet("engagement_perf");
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Snapshot for the API/UI: last refresh stamp + current top-hook ranking. */
export function getSelfAuditMeta(): { updated_at: string | null; summary: unknown } {
  const raw = metaGet("self_audit_latest");
  if (!raw) return { updated_at: null, summary: null };
  try { return { updated_at: metaGet("self_audit_last"), summary: JSON.parse(raw) as unknown }; }
  catch { return { updated_at: metaGet("self_audit_last"), summary: null }; }
}

/**
 * Lingkup 5 — operator approves the proposal: apply proposed slots.
 * Reads the stored proposal, writes it to slot_times, marks applied,
 * snapshots the previous slots for rollback, logs the decision.
 */
export function applySlotProposalNow(): { applied: boolean; times: string[]; previous: string[]; reason: string } {
  const raw = metaGet("slot_proposal");
  if (!raw) throw new Error("no slot proposal available yet — run /api/slot/proposal first");
  let proposal: { proposed: string[]; current: string[]; reason: string };
  try {
    proposal = JSON.parse(raw) as typeof proposal;
  } catch {
    throw new Error("stored slot proposal is corrupt");
  }
  const previous = slotTimes();
  if (proposal.proposed.length === 0) throw new Error("proposal has no slots to apply");
  // Snapshot for rollback (Lingkup 5 auto-rollback reads this).
  metaSet("slot_times_previous", previous.join(","));
  metaSet("slot_applied_day", dayKey(new Date()));
  setSlotTimes(proposal.proposed);
  // Mark proposal applied so the API stops returning applied:false.
  const stamped = { ...proposal, applied: true };
  metaSet("slot_proposal", JSON.stringify(stamped));
  logActivity({
    level: "info",
    source: "operator",
    event: "slot.applied",
    message: `Operator approve: slot ${previous.join(", ")} → ${proposal.proposed.join(", ")}. ${proposal.reason}`,
    meta: { previous, applied: proposal.proposed },
  });
  return { applied: true, times: proposal.proposed, previous, reason: proposal.reason };
}

export function getSlotProposalMeta(): { updated_at: string | null; proposal: unknown } {
  const raw = metaGet("slot_proposal");
  if (!raw) return { updated_at: null, proposal: null };
  try { return { updated_at: metaGet("slot_proposal_day"), proposal: JSON.parse(raw) as unknown }; }
  catch { return { updated_at: metaGet("slot_proposal_day"), proposal: null }; }
}

export function engagementInsights(): {
  updated_at: string | null;
  top_hooks: { hook: string; score: number; posts: number }[];
} {
  return { updated_at: metaGet("engagement_perf_last"), top_hooks: engagementTopHooks() ?? [] };
}

/** Effective slot times, in local time. Stored as "HH:MM,HH:MM,HH:MM". */
export function slotTimes(): string[] {
  const raw = metaGet("slot_times") || DEFAULT_SLOT_TIMES.join(",");
  const out = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^\d{1,2}:\d{2}$/.test(s))
    .map((s) => {
      const [h, m] = s.split(":");
      return `${h.padStart(2, "0")}:${m}`;
    });
  return out.length ? out.slice(0, 6) : [...DEFAULT_SLOT_TIMES];
}

export function setSlotTimes(times: string[]): string[] {
  const clean = times
    .map((s) => String(s || "").trim())
    .filter((s) => /^([01]?\d|2[0-3]):[0-5]\d$/.test(s))
    .map((s) => {
      const [h, m] = s.split(":");
      return `${h.padStart(2, "0")}:${m}`;
    });
  if (clean.length === 0) throw new Error("no valid HH:MM slot times given");
  metaSet("slot_times", clean.join(","));
  return slotTimes();
}

function dayKey(d: Date): string {
  // Local calendar day, not UTC — slots are read by humans in WIB.
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Local midnight + HH:MM, returned as an ISO-ish local string. */
function atTime(day: string, hhmm: string): Date {
  const [h, m] = hhmm.split(":").map(Number);
  const [y, mo, d] = day.split("-").map(Number);
  return new Date(y, mo - 1, d, h, m, 0, 0);
}

function nearestSlot(timeHHMM: string, slots: string[]): string {
  const [th, tm] = timeHHMM.split(":").map(Number);
  const target = th * 60 + tm;
  let best = slots[0];
  let minDiff = 1440;
  for (const s of slots) {
    const [sh, sm] = s.split(":").map(Number);
    const diff = Math.abs(sh * 60 + sm - target);
    if (diff < minDiff) { minDiff = diff; best = s; }
  }
  return best;
}

/**
 * UTC "YYYY-MM-DD HH:MM:SS" — the SAME frame of reference as SQLite's
 * datetime('now', ...) defaults used everywhere else in this DB.
 *
 * `d` here is a LOCAL wall-clock time (local midnight + HH:MM from
 * slot_times, built via new Date(y, m, d, h, m)). A local Date already knows
 * its own UTC offset, so getUTC*() is the correct way to write it down: the
 * same instant, in the column's timezone.
 *
 * Writing the local fields into a UTC column (what an earlier version did)
 * stores "09:00" for a 09:00-WIB slot that actually happens at 02:00 UTC, so
 * the due-compare fires 7 hours late.
 */
function utcStamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ` +
    `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`
  );
}

/**
 * Create today's slots if they do not exist. Idempotent — the UNIQUE index is
 * the real guard, ON CONFLICT keeps the existing row untouched so a re-run at
 * 08:59 cannot reset a slot that already published at 09:00.
 */
export function ensureSlots(now = new Date()): number {
  const day = dayKey(now);
  const times = slotTimes();
  const want = new Set(times.map((t) => utcStamp(atTime(day, t))));
  const existing = db
    .prepare(`SELECT id, scheduled_for, status FROM post_slots WHERE slot_date = ? ORDER BY slot_index`)
    .all(day) as { id: number; scheduled_for: string; status: string }[];
  const nowStamp = utcStamp(now);
  let created = 0;

  // Insert wanted times that have NO row yet (uniqueness is (date,index);
  // index order used to drift when slot_times changed, leaving two rows for
  // 21:40 and a stale 17:50 — proven live 2026-10-04. Key on the TIME now).
  const have = new Set(existing.map((e) => e.scheduled_for));
  for (const w of [...want]) {
    if (have.has(w)) continue;
    const maxIdx = (db.prepare(`SELECT COALESCE(MAX(slot_index),-1) m FROM post_slots WHERE slot_date = ?`).get(day) as { m: number }).m;
    created += db.prepare(`INSERT INTO post_slots (slot_date, slot_index, scheduled_for) VALUES (?,?,?)`).run(day, maxIdx + 1, w).changes ?? 0;
  }

  // Prune PENDING rows that don't match the wanted pattern: duplicates of the
  // same time (keep lowest id) and stale future times from an older pattern.
  // Past-due / claimed / published rows are never touched.
  const seen = new Set<string>();
  for (const e of existing) {
    if (e.status !== "pending") continue;
    const stale = !want.has(e.scheduled_for) && e.scheduled_for > nowStamp;
    const dup = seen.has(e.scheduled_for);
    if (stale || dup) {
      db.prepare(`DELETE FROM post_slots WHERE id = ?`).run(e.id);
      created -= 0; // pruning, not creation
      continue;
    }
    seen.add(e.scheduled_for);
  }
  return created;
}

/** Top up a rolling horizon so a restart never misses an entire day. */
export function ensureHorizon(days = 2): number {
  let created = 0;
  const base = new Date();
  for (let i = 0; i < days; i++) {
    created += ensureSlots(new Date(base.getTime() + i * 86_400_000));
  }
  return created;
}

/**
 * Add ONE new HH:MM to the pattern and materialize its slots.
 * New time whose clock time is still ahead today gets a slot TODAY
 * (so "tambah jam 20:00 jam 19:00" posts tonight); a time already past
 * today only materializes from tomorrow on. Returns the saved times plus
 * where the new time landed ("today" | "tomorrow").
 */
export function addSlotTime(hhmm: string): { times: string[]; lands: "today" | "tomorrow" } {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(hhmm || "").trim());
  if (!m) throw new Error(`bad HH:MM: ${hhmm}`);
  const v = `${m[1]!.padStart(2, "0")}:${m[2]}`;
  const merged = [...new Set([...slotTimes(), v])].sort().slice(0, 6);
  const times = setSlotTimes(merged);
  // Materialize: tomorrow always; today only the still-future slot.
  // NOTE: today's insert uses MAX(slot_index)+1, NOT the position in the
  // pattern — inserting at pattern index collides with an existing row from
  // the older pattern (UNIQUE slot_date+slot_index) and silently no-ops.
  const now = new Date();
  const today = dayKey(now);
  const when = atTime(today, v);
  let lands: "today" | "tomorrow" = "tomorrow";
  if (when.getTime() > now.getTime() + 60_000) {
    const maxRow = db
      .prepare(`SELECT MAX(slot_index) AS mx FROM post_slots WHERE slot_date = ?`)
      .get(today) as { mx: number | null } | undefined;
    const idx = (maxRow?.mx ?? -1) + 1;
    const r = db
      .prepare(
        `INSERT INTO post_slots (slot_date, slot_index, scheduled_for)
         VALUES (?, ?, ?)
         ON CONFLICT(slot_date, slot_index) DO NOTHING`,
      )
      .run(today, idx, utcStamp(when));
    if ((r.changes ?? 0) > 0) lands = "today";
  }
  ensureSlots(new Date(now.getTime() + 86_400_000));
  return { times, lands };
}

export function listSlots(opts: { date?: string; status?: SlotStatus; limit?: number } = {}): SlotRow[] {
  const where: string[] = [];
  const args: unknown[] = [];
  if (opts.date) { where.push("slot_date = ?"); args.push(opts.date); }
  if (opts.status) { where.push("status = ?"); args.push(opts.status); }
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const sql = `SELECT * FROM post_slots ${where.length ? "WHERE " + where.join(" AND ") : ""}
               ORDER BY scheduled_for DESC LIMIT ?`;
  return db.prepare(sql).all(...args, limit) as unknown as SlotRow[];
}

function getSlot(id: number): SlotRow | undefined {
  return db.prepare(`SELECT * FROM post_slots WHERE id = ?`).get(id) as SlotRow | undefined;
}

/** Public getter for the /api/schedule/run guard. */
export function getSlotById(id: number): SlotRow | undefined {
  return getSlot(id);
}

/** Slots that are due and unclaimed, or claimed by a lease that has expired. */
function claimableSlots(now: Date): SlotRow[] {
  const nowStamp = utcStamp(now);
  return db.prepare(
    `SELECT * FROM post_slots
     WHERE scheduled_for <= ?
       AND (status = 'pending'
            OR (status = 'claimed' AND lease_until IS NOT NULL AND lease_until < ?))
     ORDER BY scheduled_for ASC`,
  ).all(nowStamp, nowStamp) as unknown as SlotRow[];
}

/**
 * Claim a slot for `owner`. The WHERE re-checks the lease, so two ticks in the
 * same second cannot both win. 15 minutes is generous: a publish is ~20s for
 * the router, and the HD CPU fallback is the only path that runs long.
 */
function claimSlot(id: number, owner: string, ttlMs = 900_000): boolean {
  const now = new Date();
  const until = utcStamp(new Date(now.getTime() + ttlMs));
  const nowStamp = utcStamp(now);
  const r = db.prepare(
    `UPDATE post_slots SET status = 'claimed', lease_owner = ?, lease_until = ?,
                           attempts = attempts + 1
     WHERE id = ?
       AND (status = 'pending'
            OR (status = 'claimed' AND lease_until IS NOT NULL AND lease_until < ?))`,
  ).run(owner, until, id, nowStamp);
  return (r.changes ?? 0) === 1;
}

function finishSlot(
  id: number,
  patch: Partial<Pick<SlotRow, "status" | "link_id" | "platform" | "content_id" | "post_id" | "post_url" | "error">>,
): void {
  const fields = Object.entries(patch).filter(([, v]) => v !== undefined);
  if (fields.length === 0) return;
  const sets = fields.map(([k]) => `${k} = ?`).join(", ");
  db.prepare(`UPDATE post_slots SET ${sets} WHERE id = ?`).run(
    ...fields.map(([, v]) => v ?? null),
    id,
  );
}

/** Release a claim without publishing, so the next tick can retry it. */
function unclaimSlot(id: number, error: string): void {
  db.prepare(
    `UPDATE post_slots SET status = 'pending', lease_owner = NULL, lease_until = NULL, error = ? WHERE id = ?`,
  ).run(error, id);
}

const OWNER = `sched-${process.pid}`;
const TICK_MS = Number(process.env.AFFILIATE_SCHED_TICK_MS || 60_000);

/** Warm window: prepare the creative this far ahead of due time. */
const WARM_LEAD_MIN = Number(process.env.AFFILIATE_WARM_LEAD_MIN || 60);
/** Max retry rounds before a slot is declared failed. */
const MAX_ATTEMPTS = Number(process.env.AFFILIATE_SLOT_MAX_ATTEMPTS || 5);
/** Base backoff between retries (minutes), doubled each round. */
const RETRY_BASE_MIN = Number(process.env.AFFILIATE_RETRY_BASE_MIN || 15);

/**
 * Pre-warm due-soon slots: lock the link + build the creative image NOW, so
 * the due tick only publishes. Warming claims nothing — the slot stays
 * pending, and a crashed warm is simply re-warmed next tick.
 */
export async function warmSlots(now = new Date()): Promise<number> {
  const horizon = utcStamp(new Date(now.getTime() + WARM_LEAD_MIN * 60_000));
  const nowStamp = utcStamp(now);
  const cands = db.prepare(
    `SELECT * FROM post_slots
     WHERE status = 'pending' AND warmed_link_id IS NULL
       AND scheduled_for > ? AND scheduled_for <= ?
     ORDER BY scheduled_for ASC LIMIT 3`,
  ).all(nowStamp, horizon) as unknown as SlotRow[];
  let warmed = 0;
  const { recreateProductImage } = await import("./recreate-image.ts");
  // Double-post root cause (proved 2026-10-04: link25 tayang 18:51 & 20:02):
  // two slots inside the warm horizon both picked the SAME link, because
  // last_published_at only updates at publish time. Reserve each warmed link
  // for the rest of this sweep so no second slot locks onto it.
  const reserved = new Set<number>();
  for (const s of db.prepare(
    `SELECT warmed_link_id FROM post_slots WHERE status='pending' AND warmed_link_id IS NOT NULL
       AND scheduled_for > ? ORDER BY scheduled_for`,
  ).all(utcStamp(now)) as Array<{ warmed_link_id: number }>) {
    if (s.warmed_link_id) reserved.add(s.warmed_link_id);
  }
  for (const slot of cands) {
    const link = pickLink(true, reserved);
    if (!link?.image_url) continue;
    try {
      const cur = getLink(link.id);
      let media = cur?.image_url ?? link.image_url;
      const looksGen = /\/api\/images\//.test(media);
      if (!looksGen) {
        const gen = await recreateProductImage(link, undefined, undefined, { flowOnly: true });
        if (gen.ok && gen.live) media = gen.served_url;
      }
      db.prepare(
        `UPDATE post_slots SET warmed_link_id = ?, warmed_media_url = ?, warmed_at = datetime('now')
         WHERE id = ? AND status = 'pending'`,
      ).run(link.id, media, slot.id);
      reserved.add(link.id);
      warmed++;
    } catch { /* next tick retries the warm */ }
  }
  return warmed;
}

/** Enabled by default so that a boot is enough; set 0/false to pause. */
export function schedulerEnabled(): boolean {
  const raw = metaGet("enabled");
  if (raw == null) return true;
  return raw !== "0" && raw !== "false";
}

export function setSchedulerEnabled(on: boolean): void {
  metaSet("enabled", on ? "1" : "0");
}

/**
 * Links posted within the last N days — the anti-bosu set. A product posted
 * this week is skipped while fresher stock exists. Bypassed only when the
 * pool is smaller than the window (nothing else to post).
 */
const REPOST_WINDOW_DAYS = 7;

function recentLinkIds(days = REPOST_WINDOW_DAYS): Set<number> {
  const rows = db.prepare(
    `SELECT DISTINCT link_id AS id FROM post_slots
     WHERE status = 'published' AND link_id IS NOT NULL
       AND datetime(scheduled_for) >= datetime('now', ?)`,
  ).all(`-${days} days`) as Array<{ id: number }>;
  return new Set(rows.map((r) => r.id));
}

/**
 * P2.10 — pool snapshot for the alert + UI: how many links can actually post
 * right now. `usable` mirrors pickLink's primary filter (image + not dead);
 * `cooling` counts usable links inside the 3h per-link cooldown.
 */
export function poolStatus(): { total: number; usable: number; cooling: number; dead: number; no_image: number } {
  const all = listLinks();
  const dead = all.filter((l) => l.link_health === "dead").length;
  const no_image = all.filter((l) => !l.image_url && l.link_health !== "dead").length;
  const usablePool = all.filter((l) => !!l.image_url && l.link_health !== "dead");
  const COOLDOWN_MS = 3 * 60 * 60 * 1000;
  let cooling = 0;
  for (const l of usablePool) {
    const t = l.last_published_at ? Date.parse(l.last_published_at.replace(" ", "T") + "Z") : NaN;
    if (!Number.isNaN(t) && Date.now() - t < COOLDOWN_MS) cooling++;
  }
  return { total: all.length, usable: usablePool.length, cooling, dead, no_image };
}

export function pickLink(preferNew = true, exclude: Set<number> = new Set()): ReturnType<typeof getLink> {
  const all = listLinks();
  if (all.length === 0) return undefined;
  // Links with a verified image go first; links without one are still
  // eligible — preparePost enriches + recreates on the fly instead of
  // starving them forever behind the same 2-3 imaged links.
  const links = all.filter((l) => !!l.image_url && l.link_health !== "dead");
  const imageless = all.filter((l) => !l.image_url && l.link_health !== "dead");
  // All links dead per our probes? don't starve the pipeline; but a link we
  // KNOW is dead only gets posted when nothing alive remains.
  let pool = links.length > 0 ? links : imageless;
  if (pool.length === 0) pool = all.filter((l) => !!l.image_url);
  if (exclude.size > 0) pool = pool.filter((l) => !exclude.has(l.id));
  if (pool.length === 0) return undefined;

  const todayStr = dayKey(new Date());
  const postedToday = new Set<number>();
  const lastByLink = new Map<number, string>();
  for (const s of listSlots({ limit: 200 })) {
    if (s.link_id == null || s.status !== "published") continue;
    if (s.slot_date === todayStr) postedToday.add(s.link_id);
    const prev = lastByLink.get(s.link_id);
    if (!prev || s.scheduled_for > prev) lastByLink.set(s.link_id, s.scheduled_for);
  }

  // HARD per-link cooldown (3 h, last_published_at is UTC): the same product
  // must never appear in two slots minutes apart (proven: link 21 published
  // twice, 19:30 & 19:57, because pool-level anti-bosu was bypassed by the
  // small-pool rule). When EVERY link is cooling — a pool of one — we still
  // post something rather than starve, but only that last link.
  const COOLDOWN_MS = 3 * 60 * 60 * 1000;
  const cooling = new Set<number>();
  for (const l of pool) {
    const t = l.last_published_at ? Date.parse(l.last_published_at.replace(" ", "T") + "Z") : NaN;
    if (!Number.isNaN(t) && Date.now() - t < COOLDOWN_MS) cooling.add(l.id);
  }
  const elig = pool.filter((l) => !cooling.has(l.id));
  const workPool = elig.length > 0 ? elig : pool.filter((l) => cooling.has(l.id));

  // 1) Newest never-posted link first — fresh products get priority.
  // Anti-bosu: links posted within REPOST_WINDOW_DAYS are skipped while
  // anything else exists. Bypassed when the pool is smaller than the window.
  const recent = recentLinkIds();
  const unrecent = (arr: ReturnType<typeof listLinks>) =>
    arr.length > recent.size ? arr.filter((l) => !recent.has(l.id)) : arr;
  const freshAll = workPool.filter((l) => !lastByLink.has(l.id));
  const fresh = unrecent(freshAll);
  if (preferNew && fresh.length > 0) return fresh[fresh.length - 1];

  // 2) Otherwise least-recently-posted, but never a link already posted today.
  const restAll = workPool
    .filter((l) => !postedToday.has(l.id))
    .sort((a, b) => {
      const ta = lastByLink.get(a.id) ?? "";
      const tb = lastByLink.get(b.id) ?? "";
      return ta < tb ? -1 : ta > tb ? 1 : 0;
    });
  const rest = unrecent(restAll);
  if (rest.length > 0) return rest[0];

  // 3) Everything was posted today already: pick the link whose last publish
  // is FURTHEST back — the cooldown queue order. Honours the 3h rule as far as
  // the pool allows (a one-link pool posts it; starving is worse than repeat).
  const byIdle = [...workPool].sort((a, b) => {
    const ta = a.last_published_at ? Date.parse(a.last_published_at.replace(" ", "T") + "Z") : 0;
    const tb = b.last_published_at ? Date.parse(b.last_published_at.replace(" ", "T") + "Z") : 0;
    return ta - tb;
  });
  return byIdle[0] ?? pool[pool.length - 1];
}

/**
 * Providers that can actually take a post right now.
 *
 * The mediaUrl test is NOT done here: the DB stores a local path
 * (/api/images/…), which is expanded to the public origin only when the post
 * is built. Checking it at this point rejects every link.
 */
function publishablePlatforms(): { provider: SocialProvider; platform: PlatformKey }[] {
  const out: { provider: SocialProvider; platform: PlatformKey }[] = [];
  for (const key of MYSTERY_PLATFORMS) {
    const p = listProviders().find((v) => v.slug === key);
    if (!p || p.status !== "VERIFIED-EXECUTED") continue;
    // A provider that cannot take media is useless here: every slot carries a
    // recreated product image.
    if (!p.capabilities.imagePost) continue;
    out.push({ provider: p, platform: key });
  }
  return out;
}

type PreparedTarget = {
  platform: PlatformKey;
  draft: ReturnType<typeof buildMysteryCaption>;
  /** Final caption text (draft.body + Threads inline link when applicable). */
  text: string;
  media_url: string;
  content_id: number;
  /** Threads topic_tag derived from the link's product type (null = none). */
  topicTag: string | null;
};

/** One slot's fan-out: the same link prepared for every platform. */
type PreparedPost = {
  link_id: number;
  targets: PreparedTarget[];
};

/**
 * Build caption + persist a draft row per platform, or throw. Never publishes.
 * The link is picked ONCE per slot so every platform posts the same product.
 */
async function preparePost(slot: SlotRow): Promise<PreparedPost> {
  // Pre-warmed slot: the link + creative were locked before due time.
  // Reuse them — the due tick only publishes.
  let link = pickLink();
  let warmedMedia: string | null = null;
  if (slot.warmed_link_id) {
    const wl = getLink(slot.warmed_link_id);
    if (wl?.image_url) {
      // Second double-post guard (see warmSlots): if this link got published
      // by an earlier slot inside the cooldown window, re-pick a fresh one
      // instead of re-using the stale warm.
      const COOLDOWN_MS = 3 * 60 * 60 * 1000;
      const t = wl.last_published_at ? Date.parse(wl.last_published_at.replace(" ", "T") + "Z") : NaN;
      const hot = !Number.isNaN(t) && Date.now() - t < COOLDOWN_MS;
      if (hot) {
        const alt = pickLink(true, new Set([wl.id]));
        if (!alt) throw new Error(`all links in cooldown — warmed link ${wl.id} is hot`);
        link = alt; // drop the stale warm media — preparePost uses alt's own image
      } else {
        link = wl;
        warmedMedia = slot.warmed_media_url ?? null;
      }
    }
  }
  if (!link) throw new Error("no link available to post");

  // Imageless link picked: enrich (og fetch) + seal + recreate NOW, so it
  // can still post this slot instead of being skipped forever.
  if (!link.image_url) {
    const { fetchOg, checkImageUrl } = await import("./shopee.ts");
    try {
      const og = await fetchOg(link.short_url);
      if (og?.title || og?.image) {
        const { productName } = await import("./templates.ts");
        const { enrichLink } = await import("./store.ts");
        let verified = false;
        if (og.image) verified = (await checkImageUrl(og.image)).ok;
        const prod = og.title ? productName(og.title) : link.product;
        const img = (verified ? og.image : null) ?? link.image_url;
        enrichLink(link.id, { product: prod, image_url: img, deskripsi: og.description ?? link.deskripsi });
        if (verified && og.image) {
          const { sealOriginalImage, getLink } = await import("./store.ts");
          sealOriginalImage(link.id, og.image);
          link = getLink(link.id) ?? link;
        } else {
          link = { ...link, product: prod, image_url: img };
        }
      }
    } catch { /* keep the row as-is — recreate attempt below decides */ }
  }
  if (!link.image_url) throw new Error(`link ${link.id} has no fetchable image even after enrich`);

  const targets = publishablePlatforms();
  if (targets.length === 0) {
    throw new Error(
      "no publishable platform: every provider is disconnected or cannot post media",
    );
  }

  const idForImg = buildIdentity({ product: link.product ?? null, kategori: link.kategori ?? null, shop: link.shop ?? null });
  const _imgPromptProductAware = imagePromptFor(idForImg); // used by recreate-image chain
  // Same rule as POST /api/links/:id/post: never publish the raw Shopee CDN
  // photo when a generated creative is missing — recreate first. Links whose
  // image was generated with a pre-premium prompt are also regenerated, so
  // the cron converges every product to the premium style over time.
  // The creative is generated ONCE per slot and shared by all platforms.
  // A warmed creative skips regeneration entirely — it was built pre-due.
  // Both branches MUST go through absoluteForProvider: the warm step stores a
  // LOCAL path (/api/images/…) in warmed_media_url, and Meta rejects any
  // non-http URL outright (proven live: slot 35684 — all three platforms
  // refused "mediaUrl must be an http(s) URL").
  let mediaUrl = absoluteForProvider(warmedMedia ?? link.image_url!);
  // "Generated" means OUR served creative (affine /api/images or local path).
  // A warmed CDN/suser URL is NOT a generated creative — proven live: slot
  // 26506 warmed the raw susercontent photo (recreate died on the then-dead
  // gate), looksGenerated wrongly said true, Threads refused it with Meta's
  // "unknown error" while IG/FB fetched it fine. Only our own URL is fetchable
  // by every platform.
  const isOurCreative = (u: string) =>
    /^https?:\/\/affine\.realpaytrans\.my\.id\/api\/images\//.test(u) || u.startsWith("/api/images/");
  const looksGenerated = isOurCreative(warmedMedia ?? "") || isOurCreative(mediaUrl);
  const { recreateProductImage } = await import("./recreate-image.ts");
  if (!looksGenerated) {
    try {
      const gen = await recreateProductImage(link);
      // live=false = review rejected → keep mediaUrl on the original photo.
      if (gen.ok && gen.live) mediaUrl = absoluteForProvider(gen.served_url);
    } catch { /* keep the CDN photo — a post beats no post */ }
  } else {
    // Regenerate once: creatives made before the premium master prompt
    // (file older than the prompt's introduction) get one regeneration.
    // Afterwards the file is fresh and this branch stays quiet.
    try {
      const { needsPremiumRegen } = await import("./recreate-image.ts");
      if (await needsPremiumRegen(link)) {
        const gen = await recreateProductImage(link);
        if (gen.ok && gen.live) mediaUrl = absoluteForProvider(gen.served_url);
      }
    } catch { /* keep the existing creative on any failure */ }
  }
  if (!mediaUrl) throw new Error("recreated image has no fetchable URL");

  const publishIndex = (slot.attempts ?? 0) + (slot.id % 100);
  // Smart caption (AI): one story per slot, shared by every platform — same
  // "one link per slot" rule as the creative. Null (dead router / validation
  // reject / AFFILIATE_SMART_CAPTION=0) = template draft exactly as before.
  const story = await smartCaption(
    { product: link.product ?? null, kategori: link.kategori ?? null, shop: link.shop ?? null },
    chooseFewShotHooks(engagementTopHooks() ?? []),
  );
  if (story) {
    const used = chooseFewShotHooks(engagementTopHooks() ?? []);
    logActivity({ level: "info", source: "system", event: "caption.smart",
      message: `link ${link.id}: AI story (${story.hook.slice(0, 40)}…) for all ${targets.length} platforms${used.length > 0 ? ` [few-shot: ${used.length} hooks]` : ""}` });
  }
  const trendTags = cachedTrends(2).map((t) => t.tag);
  const prepared: PreparedPost = { link_id: link.id, targets: [] };
  for (const target of targets) {
    let draft = buildMysteryCaption(target.platform, {
      short_url: link.short_url,
      resolved_url: link.resolved_url,
      shopee_shop_id: link.shopee_shop_id,
      shopee_item_id: link.shopee_item_id,
      shop: link.shop,
      product: link.product,
      image_url: link.image_url,
      kategori: link.kategori ?? null,
      sheet_id: link.sheet_id ?? null,
    }, publishIndex, trendTags);
    if (story) draft = { ...draft, body: composeSmartBody(story, target.platform, detectType(idForImg), link.sheet_id ?? null, trendTags) };

    let text = draft.body;
    if (target.platform === "threads" && link.short_url && !text.includes(link.short_url)) {
      text = `${text}\n\n${link.short_url}`;
    }

    const row = addContent({
      link_id: link.id,
      platform: target.platform,
      kind: "image",
      body: text,
      media_url: mediaUrl,
      first_comment: null,
    });

    prepared.targets.push({
      platform: target.platform,
      draft,
      text,
      media_url: mediaUrl,
      content_id: row.id,
      topicTag: target.platform === "threads" ? topicFor(detectType(idForImg)) : null,
    });
  }

  return prepared;
}

/**
 * The image_url in the DB is a local path (/api/images/…). Meta will not fetch
 * from the app's own hostname, so it is expanded to the public origin.
 *
 * ponytail: BIO_PUBLIC_BASE is expected in the environment (the service unit
 * sets it). The fallback is the deployed origin rather than loopback, because
 * a loopback URL is always rejected by the platforms — failing loudly here
 * beats silently publishing a broken media URL. Hardcoded in index.html too.
 */
const PUBLIC_ORIGIN = "https://affine.realpaytrans.my.id";

function absoluteForProvider(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  const raw = (process.env.BIO_PUBLIC_BASE ?? "").trim().replace(/\/+$/, "");
  if (raw && /^https?:\/\//i.test(raw)) return raw + url;
  if (raw) {
    logActivity({
      level: "warn",
      source: "system",
      event: "schedule.origin_fallback",
      message: `BIO_PUBLIC_BASE=${raw} is not an http(s) origin; using ${PUBLIC_ORIGIN}`,
    });
  }
  return PUBLIC_ORIGIN + url;
}

function providerFor(slug: string): SocialProvider | undefined {
  return listProviders().find((p) => p.slug === slug);
}

/**
 * Run one claimed slot end to end: the same product goes to EVERY publishable
 * platform. Per-platform outcome:
 *   - ok → its content row published, counted in `done`
 *   - validate/publish fail → its content row rejected, slot error notes it
 * The slot is `published` when at least one platform succeeded; otherwise it
 * returns to pending (retry) until attempts run out, then failed.
 * Returns the slot after its outcome is stored.
 */
export async function runSlot(slot: SlotRow): Promise<SlotRow> {
  let prepared: PreparedPost;
  try {
    prepared = await preparePost(slot);
  } catch (e) {
    const msg = String(e).slice(0, 400);
    finishSlot(slot.id, {
      status: slot.attempts > 2 ? "failed" : "pending",
      error: msg,
      link_id: null,
      platform: null,
    });
    logActivity({
      level: "warn",
      source: "system",
      event: "schedule.prepare",
      status: Number(slot.id),
      message: msg,
      meta: { slot_date: slot.slot_date, slot_index: slot.slot_index, attempts: slot.attempts },
    });
    return getSlot(slot.id)!;
  }

  const done: { platform: string; content_id: number; post_id: string | null; post_url: string | null }[] = [];
  const failed: { platform: string; content_id: number; error: string }[] = [];

  for (const target of prepared.targets) {
    const provider = providerFor(target.platform);
    if (!provider) {
      setContentStatus(target.content_id, "rejected", { error: `provider ${target.platform} not registered` });
      failed.push({ platform: target.platform, content_id: target.content_id, error: "provider not registered" });
      continue;
    }

    const content: SocialContent = {
      text: target.text,
      mediaUrl: target.media_url,
      mediaKind: "image",
      link: linkShort(prepared.link_id),
      ...(target.topicTag ? { topicTag: target.topicTag } : {}),
    };

    const t0 = Date.now();
    try {
      const check = await provider.validateContent(content);
      if (!check.ok) {
        const err = check.errors.join("; ");
        setContentStatus(target.content_id, "rejected", { error: err });
        failed.push({ platform: target.platform, content_id: target.content_id, error: err });
        logActivity({
          level: "warn",
          source: "system",
          event: "schedule.reject",
          message: err,
          meta: { platform: target.platform, content_id: target.content_id },
        });
        continue;
      }

      const res = await provider.publish(content);
      const ms = Date.now() - t0;

      if (res.ok) {
        // Instagram hands back a container id that may never go live — verify
        // via getPostStatus (permalink present = really published).
        let igNote: string | null = null;
        if (target.platform === "instagram" && res.postId && provider.getPostStatus) {
          const st = await provider.getPostStatus(res.postId);
          if (st.state !== "published") {
            igNote = `instagram verify: ${st.state} (${st.detail ?? "no permalink"})`;
            setContentStatus(target.content_id, "rejected", { error: igNote });
            failed.push({ platform: target.platform, content_id: target.content_id, error: igNote });
            logActivity({
              level: "warn",
              source: "system",
              event: "schedule.publish",
              status: 502,
              duration_ms: ms,
              message: igNote,
              meta: { platform: target.platform, content_id: target.content_id, attempts: slot.attempts },
            });
            continue;
          }
        }
        setContentStatus(target.content_id, "published", {
          post_id: res.postId ?? null,
          post_url: res.url ?? null,
          error: null,
        });
        done.push({ platform: target.platform, content_id: target.content_id, post_id: res.postId ?? null, post_url: res.url ?? null });
        logActivity({
          level: "info",
          source: "system",
          event: "schedule.publish",
          status: 200,
          duration_ms: ms,
          message: res.url || res.postId || "published",
          meta: {
            platform: target.platform,
            link_id: prepared.link_id,
            content_id: target.content_id,
            slot_date: slot.slot_date,
            slot_index: slot.slot_index,
          },
        });
      } else {
        const err = (res.error || "publish failed").slice(0, 400);
        setContentStatus(target.content_id, "rejected", { error: err });
        failed.push({ platform: target.platform, content_id: target.content_id, error: err });
        logActivity({
          level: "error",
          source: "system",
          event: "schedule.publish",
          status: 502,
          duration_ms: ms,
          message: err,
          meta: { platform: target.platform, content_id: target.content_id, attempts: slot.attempts },
        });
      }
    } catch (e) {
      const err = String(e).slice(0, 400);
      setContentStatus(target.content_id, "rejected", { error: err });
      failed.push({ platform: target.platform, content_id: target.content_id, error: err });
      logActivity({
        level: "error",
        source: "system",
        event: "schedule.error",
        message: err,
        meta: { platform: target.platform, content_id: target.content_id },
      });
    }
  }

  // Slot verdict from the fan-out: any success wins; total failure retries.
  const first = done[0];
  if (first) {
    const errNote = failed.length
      ? `partial: ${failed.map((f) => `${f.platform}: ${f.error}`).join(" | ").slice(0, 300)}`
      : null;
    finishSlot(slot.id, {
      status: "published",
      link_id: prepared.link_id,
      platform: done.map((d) => d.platform).join(","),
      content_id: first.content_id,
      post_id: first.post_id,
      post_url: first.post_url,
      error: errNote,
    });
    // Penanda link: auto-publish harus menandai links juga. reconcile dari
    // tabel content (satu sumber kebenaran) — murah, idempoten, sekaligus
    // memperbaiki row lama yang belum pernah ditandai.
    if (prepared.link_id != null) {
      try {
        syncLinkMarkers();
      } catch { /* marker is advisory */ }
    }
  } else {
    // Smart retry: exponential backoff (15m → 30m → 60m …) instead of failing
    // at 3 attempts. The slot stays pending and the next tick re-claims it at
    // the pushed time, so a transient Threads outage no longer kills the slot.
    const err = failed.map((f) => `${f.platform}: ${f.error}`).join(" | ").slice(0, 400) || "all platforms failed";
    if (slot.attempts >= MAX_ATTEMPTS) {
      finishSlot(slot.id, {
        status: "failed",
        error: err,
        link_id: prepared.link_id,
        platform: null,
        content_id: failed[0]?.content_id ?? null,
      });
    } else {
      const delayMin = RETRY_BASE_MIN * 2 ** Math.max(0, slot.attempts - 1);
      const retryAt = utcStamp(new Date(Date.now() + delayMin * 60_000));
      db.prepare(
        `UPDATE post_slots SET status = 'pending', lease_owner = NULL, lease_until = NULL,
         error = ?, scheduled_for = ?, warmed_link_id = NULL, warmed_media_url = NULL, warmed_at = NULL
         WHERE id = ?`,
      ).run(`retry in ~${delayMin}m (${slot.attempts}/${MAX_ATTEMPTS}): ${err}`.slice(0, 500), retryAt, slot.id);
    }
  }
  return getSlot(slot.id)!;
}

function linkShort(id: number): string {
  return getLink(id)?.short_url ?? "";
}

/** One tick: top up slots, warm due-soon creatives, then publish everything due. */
export async function tick(now = new Date()): Promise<{ ran: SlotRow[]; created: number; warmed: number }> {
  const created = ensureSlots(now);
  if (!schedulerEnabled()) return { ran: [], created, warmed: 0 };

  // Trending prefetch (newsjack hashtags) — feed the cache the sync caption
  // builder reads. Best-effort: provider down = last cache stays, posts go.
  try {
    const t = await fetchTopTrends(3);
    if (t.length > 0) logActivity({ level: "info", source: "system", event: "trends.refresh", message: t.map((x) => x.tag).join(" ") });
  } catch { /* advisory */ }

  // P2.7 — daily hook_perf recompute (meta-gated, pure SQL over post_metrics).
  try {
    refreshHookPerf(now);
  } catch { /* advisory — rotation continues without perf signal */ }
  // Engagement learning engine — daily top-hook ranking for smart-caption.
  try {
    refreshEngagementPerf(now);
  } catch { /* advisory — AI captions continue without few-shot signal */ }
  // Lingkup 1 — daily self-audit (deterministic numbers + optional AI text).
  try {
    const last = metaGet("self_audit_last") ?? "";
    if (last.slice(0, 10) !== dayKey(now)) {
      const { runSelfAudit } = await import("./self-analyst.ts");
      const s = await runSelfAudit({ get: metaGet, set: metaSet }, "24h");
      metaSet("self_audit_last", now.toISOString());
      logActivity({ level: "info", source: "system", event: "self.audit.done", message: `${s.publishing.publishes} publish / ${s.validator.rejects} reject / ${s.recommendations.length} rekomendasi (${s.source})` });
    }
  } catch { /* advisory — audit failure never blocks posting */ }

  // Lingkup 2 — AI Hook Lab.
  // Daily: natural-selection sweep (retire evolved hooks below baseline).
  // Weekly: generate new variants from proven winners (meta-gated by ISO week).
  try {
    const { initHookLabTable, listEvolvedHooks, evaluateEvolvedHookSurvival, generateEvolvedHook } =
      await import("./hook-lab.ts");
    initHookLabTable(db);
    // retire sweep — daily
    const active = listEvolvedHooks(db, undefined, "active");
    if (active.length > 0) {
      const baseline = Number(metaGet("engagement_baseline_mean") ?? 0.35);
      for (const h of active) {
        try { evaluateEvolvedHookSurvival(db, h.id, { impressions: h.impressions, score: h.score, baseline_mean: baseline }); }
        catch { /* single hook failure never blocks the rest */ }
      }
    }
    // generation — weekly (ISO week key gate)
    const weekKey = `${now.getUTCFullYear()}-W${Math.ceil(((now.getTime() - Date.UTC(now.getUTCFullYear(), 0, 1)) / 86400000 + 1) / 7)}`;
    if ((metaGet("hooklab_gen_week") ?? "") !== weekKey) {
      const types = ["helm", "gadget", "rumah", "fashion", "tas", "sepatu", "skincare", "outdoor", "mainan", "olahraga", "lain"];
      const key = process.env.AFFILIATE_ROUTER_KEY;
      let generated = 0;
      if (key && process.env.AFFILIATE_HOOK_LAB_AI !== "0") {
        const complete = async (prompt: string): Promise<string | null> => {
          const r = await fetch(`${process.env.AFFILIATE_ROUTER_BASE_URL || "https://router2nd.realpaytrans.my.id/v1"}/chat/completions`, {
            method: "POST",
            signal: AbortSignal.timeout(30_000),
            headers: { authorization: `Bearer ${process.env.AFFILIATE_ROUTER_KEY ?? ""}`, "content-type": "application/json" },
            body: JSON.stringify({ model: process.env.AFFILIATE_HOOK_LAB_MODEL || "ag/gemini-3.8-flash", messages: [{ role: "user", content: prompt }], temperature: 0.9, max_tokens: 300, stream: false }),
          });
          if (!r.ok) return null;
          const txt = await r.text();
          try { return (JSON.parse(txt) as { choices?: { message?: { content?: string } }[] }).choices?.[0]?.message?.content ?? null; }
          catch { return null; }
        };
        for (const t of types) {
          const top = (engagementTopHooks() ?? []).slice(0, 3).map((h: { hook: string }) => h.hook);
          if (top.length === 0) break; // no proven winners yet — don't guess
          const row = await generateEvolvedHook(db, t, top, complete);
          if (row) generated++;
          if (generated >= 3) break; // 3 new hooks per week, hard cap
        }
      }
      metaSet("hooklab_gen_week", weekKey);
      metaSet("hooklab_gen_last", now.toISOString());
      if (generated > 0) logActivity({ level: "info", source: "system", event: "hooklab.week", message: `${generated} evolved hooks generated this week` });
    }
  } catch { /* advisory — hook lab failure never blocks posting */ }

  // Lingkup 4 — score self-tuning (14-day cycle, ±20% per iteration, auto
  // rollback on 2 consecutive drawdown periods). Evaluates total engagement
  // of the last 14d vs the 14d before, derives candidate weights from the
  // observed action mix, and persists to scheduler_meta['engagement_weights'].
  try {
    const lastTune = metaGet("engagement_tune_last") ?? "";
    const daysSince = lastTune ? Math.floor((now.getTime() - new Date(lastTune).getTime()) / 86_400_000) : 999;
    if (daysSince >= 14) {
      const rows = metricsWithPostTime(42).map((r) => ({ created_at: r.created_at, metrics: JSON.parse(r.metrics) as Record<string, number> }));
      const mid = 14;
      const recent = rows.filter((r) => r.created_at >= new Date(now.getTime() - 28 * 86_400_000).toISOString());
      const prior = rows.filter((r) => r.created_at < new Date(now.getTime() - 28 * 86_400_000).toISOString());
      const totals = (rs: typeof rows) => rs.reduce((a, r) => {
        a.views += r.metrics.views ?? 0; a.likes += (r.metrics.likes ?? 0) + (r.metrics.saves ?? 0);
        a.comments += r.metrics.comments ?? 0; a.shares += r.metrics.shares ?? 0;
        return a;
      }, { views: 0, likes: 0, comments: 0, shares: 0 });
      const cur = totals(recent), prv = totals(prior);
      let weights: EngagementWeights;
      try { weights = { ...DEFAULT_WEIGHTS, ...(JSON.parse(metaGet("engagement_weights") ?? "{}") as Partial<EngagementWeights>) }; }
      catch { weights = { ...DEFAULT_WEIGHTS }; }
      // Drawdown = last 14d engagement score below the previous 14d's.
      const curScore = calculateEngagementScore(cur, weights);
      const prvScore = calculateEngagementScore(prv, weights);
      const isDrawdown = curScore < prvScore;
      let drawdownPeriods = Number(metaGet("engagement_drawdown") ?? 0);
      drawdownPeriods = isDrawdown ? drawdownPeriods + 1 : 0;
      // Candidate: bias toward the action mix that actually moved engagement.
      const curPosts = Math.max(1, recent.length);
      const cand: EngagementWeights = {
        views: weights.views,
        likes: cur.likes / curPosts,
        comments: cur.comments / curPosts,
        shares: cur.shares / curPosts,
      };
      const scale = DEFAULT_WEIGHTS.shares / Math.max(0.001, cand.shares);
      const normalized: EngagementWeights = {
        views: cand.views, likes: cand.likes * scale, comments: cand.comments * scale, shares: cand.shares * scale,
      };
      const tuned = tuneEngagementWeights(weights, normalized, { drawdownPeriods });
      metaSet("engagement_weights", JSON.stringify(tuned.weights));
      metaSet("engagement_drawdown", String(drawdownPeriods));
      metaSet("engagement_tune_last", now.toISOString());
      logActivity({
        level: tuned.rollback ? "warn" : "info",
        source: "system", event: "engagement.tune",
        message: `skor ${curScore.toFixed(0)} vs ${prvScore.toFixed(0)} (${isDrawdown ? "drawdown" : "naik"}) — ${tuned.reason}`,
        meta: { weights: tuned.weights, rollback: tuned.rollback, drawdown: drawdownPeriods },
      });
    }
  } catch { /* advisory — ranking continues with current weights */ }

  // Lingkup 5 — next-day slot proposal (nightly, propose-only).
  // Runs once per day after midnight. Reads 7d engagement per slot, writes a
  // proposal to scheduler_meta['slot_proposal']. NEVER mutates slot_times —
  // the operator reviews and applies via POST /api/scheduler/slots.
  try {
    const { proposeNextDaySlots } = await import("./slot-scheduler.ts");
    const dayKey = now.toISOString().slice(0, 10);
    if ((metaGet("slot_proposal_day") ?? "") !== dayKey) {
      const current = slotTimes();
      // Aggregate engagement per slot over the last 7 days.
      const obsMap = new Map<string, { eng: number; posts: number }>();
      for (const slot of current) obsMap.set(slot, { eng: 0, posts: 0 });
      for (const r of metricsWithPostTime(7)) {
        const hour = new Date(r.created_at).getUTCHours();
        const min = new Date(r.created_at).getUTCMinutes();
        const key = `${String(hour).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
        const slot = nearestSlot(key, current);
        if (!slot) continue;
        const m = JSON.parse(r.metrics) as Record<string, number>;
        const eng = calculateEngagementScore(m, { ...DEFAULT_WEIGHTS, ...(JSON.parse(metaGet("engagement_weights") ?? "{}") as Partial<EngagementWeights>) });
        const b = obsMap.get(slot);
        if (b) { b.eng += eng; b.posts += 1; }
      }
      const observations = [...obsMap.entries()].map(([slot, v]) => ({ slot, eng: v.eng, posts: v.posts }));
      const proposal = proposeNextDaySlots(current, observations);
      metaSet("slot_proposal", JSON.stringify(proposal));
      metaSet("slot_proposal_day", dayKey);
      if (proposal.shifts.length > 0) {
        logActivity({
          level: "info", source: "system", event: "slot.propose",
          message: `Usulan slot besok: ${proposal.proposed.join(", ")} — ${proposal.reason}`,
          meta: { shifts: proposal.shifts },
        });
      }
    }
  } catch { /* advisory — slots stay as-is */ }

  // Link health: daily sweep (meta-gated, cheap probe per link ~1s). A dead
  // affiliate link = zero commission; never post one. First pass runs at boot.
  try {
    const last = metaGet("link_health_last") ?? "";
    if (last.slice(0, 10) !== dayKey(now)) {
      const { checkLinkHealth } = await import("./link-health.ts");
      const h = await checkLinkHealth();
      metaSet("link_health_last", now.toISOString());
      logActivity({ level: h.dead > 0 ? "warn" : "info", source: "system", event: "link.health.sweep", message: `checked ${h.checked}, alive ${h.alive}, dead ${h.dead}`, meta: h });
    }
  } catch { /* advisory — never blocks posting */ }

  // Analytics loop: hourly, max 6 composio pulls per batch (rate discipline —
  // unbounded pulls pinned this VPS at load 10 before; see 8fbe017).
  try {
    const lastPull = Number(metaGet("metrics_last_pull_ts") ?? 0);
    if (now.getTime() - lastPull > 60 * 60 * 1000) {
      metaSet("metrics_last_pull_ts", String(now.getTime()));
      const { pullMetricsBatch } = await import("./analytics.ts");
      await pullMetricsBatch();
    }
  } catch { /* advisory */ }

  // P2.10 — pool alert: a dead affiliate link is invisible until posts starve.
  // Warn (once/day) when usable pool is thin or many links are marked dead.
  try {
    const ps = poolStatus();
    if ((ps.usable < 3 || ps.dead > 0) && (metaGet("pool_alert_last") ?? "").slice(0, 10) !== dayKey(now)) {
      metaSet("pool_alert_last", now.toISOString());
      logActivity({
        level: ps.usable < 3 ? "warn" : "info",
        source: "system",
        event: "pool.alert",
        message: `pool: ${ps.usable} usable, ${ps.dead} dead, ${ps.cooling} cooling${ps.usable < 3 ? " — tambah link Shopee atau bersihkan yang mati" : ""}`,
        meta: ps,
      });
    }
  } catch { /* advisory */ }

  let warmed = 0;
  try {
    warmed = await warmSlots(now);
  } catch { /* warming is best-effort — the due path still works */ }

  // Threads auto-reply sweep — same tick, opt-in via THREADS_AUTOREPLY=1.
  // Manual POST still works; the tick just stops needing a separate cron.
  // Best-effort: a reply failure never blocks the posting path below.
  try {
    if (process.env.THREADS_AUTOREPLY === "1") {
      const publishedAll = listContent().filter(
        (c) => c.platform === "threads" && c.status === "published" && c.post_id,
      );
      const { replyScopesReady, fetchComments, publishReply } = await import("../providers/threads-replies.ts");
      const ready = await replyScopesReady();
      if (ready.ok) {
        const { answeredCommentIds, recordReply, getLink } = await import("./store.ts");
        const { templateReply, aiReplyText } = await import("./thread-replies.ts");
        const answered = answeredCommentIds();
        const since = new Date(Date.now() - 7 * 86400 * 1000).toISOString();
        let repliedN = 0;
        for (const row of publishedAll.slice(0, 6)) {
          if (repliedN >= 5) break;
          try {
            const comments = await fetchComments(String(row.post_id), since);
            for (const c of comments) {
              if (c.mine || !c.text.trim() || answered.has(c.id)) continue;
              const link = row.link_id ? getLink(row.link_id) : null;
              // AI-first: jawaban nyambung + grounded ke caption post & produk;
              // template = fallback kalau gateway mati (reply tak pernah gagal total)
              const text = (await aiReplyText(c.text, { product: link?.product ?? null, kategori: link?.kategori ?? null, postText: row.body ?? null }))
                ?? templateReply(c.text, link?.product ?? null);
              const rid = await publishReply(text, c.id);
              if (rid) {
                recordReply({ content_id: row.id, comment_id: c.id, comment_user: c.username, comment_text: c.text.slice(0, 200), reply_text: text });
                answered.add(c.id);
                repliedN++;
                await new Promise((r) => setTimeout(r, 5000));
              }
            }
          } catch { /* one post's failure never kills the sweep */ }
        }
        if (repliedN > 0) logActivity({ level: "info", source: "system", event: "threads.autoreply", message: `auto-replied ${repliedN} comments (official API, AI-first)` });
      } else {
        // scopes missing → unofficial sweep (currently blind) + loud once/day
        const { scanReplies } = await import("./thread-replies.ts");
        const { answeredCommentIds, recordReply } = await import("./store.ts");
        const out = await scanReplies(publishedAll, answeredCommentIds(), { dryRun: false });
        for (const r of out.published) {
          try {
            recordReply({ content_id: r.contentId, comment_id: r.commentId, comment_user: r.commentUser, comment_text: r.commentText, reply_text: r.replyText });
          } catch { /* one bad row never blocks the rest */ }
        }
        if (out.published.length > 0) logActivity({ level: "info", source: "system", event: "threads.autoreply", message: `auto-replied ${out.published.length} comments (unofficial)` });
        const lastWarn = metaGet("reply_scope_warn_day") ?? "";
        if (lastWarn !== dayKey(now)) {
          metaSet("reply_scope_warn_day", dayKey(now));
          logActivity({ level: "warn", source: "system", event: "threads.reply.scopes", message: `auto-reply resmi BELUM aktif: ${ready.reason} — operator perlu re-consent OAuth (scope replies)` });
        }
      }
    }
  } catch { /* reply sweep is best-effort — the due path still works */ }

  const due = claimableSlots(now);
  const ran: SlotRow[] = [];
  for (const slot of due) {
    if (!claimSlot(slot.id, OWNER)) continue; // lost the race
    ran.push(await runSlot(slot));
  }
  if (ran.length > 0 || due.length > 0) {
    logActivity({
      level: "info",
      source: "system",
      event: "schedule.tick",
      message: `tick ran ${ran.length}/${due.length} due slots`,
      meta: { ran: ran.map((s) => ({ id: s.id, status: s.status, platform: s.platform, post_id: s.post_id })) },
    });
  }
  /**
   * Permalink backfill: Instagram publish returns a post_id but the permalink
   * only exists minutes later (proven: content 71 post_url null at publish).
   * Every tick (60 s) checks published rows still missing post_url and fills
   * them from getPostStatus — cheap (one Composio GET per missing row).
   */
  try {
    await backfillPermalinks();
  } catch { /* best-effort; never blocks the posting path */ }

  // Penanda link direkonsiliasi dari content tiap tick — murah (1 query),
  // idempoten, sekaligus backfill row lama yang belum pernah ditandai.
  try { syncLinkMarkers(); } catch { /* advisory */ }

  return { ran, created, warmed };
}

// Per-content cooldown for PERMANENT-FAIL permalink checks (proven: 5 Facebook
// rows with bare-numeric ids rejected by FACEBOOK_GET_POST "Invalid post_id
// format" retried every 60s tick = 300 composio CLI spawns/hour, 90% CPU each —
// this alone pinned the VPS at load 10+). A miss is parked for 30 min and
// retried later (IG permalinks legitimately appear minutes late); on restart
// the map resets — fine, that is just one backfill burst.
const permalinkFailCooldown = new Map<number, number>();
const PERMALINK_RETRY_MS = 30 * 60 * 1000;

async function backfillPermalinks(): Promise<void> {
  const { listContent, setContentPostUrl, setLinkPublishedUrl } = await import("./store.ts");
  const now = Date.now();
  const missing = listContent()
    .filter((c) => c.status === "published" && c.post_id && !c.post_url)
    // Proven 2026-10-09: content 16-27 (Sep 26) have post_ids whose Media node
    // answers id-only — caption/permalink/like_count ALL rejected. The media
    // does not exist on Meta; no retry will ever fill post_url. Rows older
    // than 7 days are permanent misses — drop them instead of parking on the
    // 30-min cooldown forever.
    .filter((c) => Date.now() - Date.parse(c.created_at) < 7 * 24 * 60 * 60 * 1000)
    .sort((a, b) => b.id - a.id)
    .filter((c) => now - (permalinkFailCooldown.get(c.id) ?? 0) > PERMALINK_RETRY_MS)
    .slice(0, 5);
  for (const c of missing.slice(0, 5)) {
    const p = getProvider(c.platform);
    if (!p?.getPostStatus) continue;
    const st = await p.getPostStatus(c.post_id!);
    const perma = st.detail && /^https?:\/\//.test(st.detail) ? st.detail : null;
    if (!perma) permalinkFailCooldown.set(c.id, now);
    if (perma) {
      setContentPostUrl(c.id, perma);
      if (c.link_id) setLinkPublishedUrl(c.link_id, perma);
      logActivity({
        level: "info",
        source: "system",
        event: "schedule.permalink",
        message: `post_url backfilled content ${c.id}`,
        meta: { content_id: c.id, platform: c.platform, post_url: perma },
      });
    }
  }
}

/** Publish one slot by id now, ignoring its scheduled time. */
export async function runSlotNow(id: number): Promise<SlotRow> {
  ensureSlots();
  const slot = getSlot(id);
  if (!slot) throw new Error(`no slot ${id}`);
  if (slot.status === "published") return slot;
  if (!claimSlot(id, OWNER)) throw new Error(`slot ${id} is claimed by another process`);
  return runSlot({ ...slot, attempts: Math.max(slot.attempts, 1) });
}

/** Slot for a given date/index, used by the manual "post now" button. */
export function slotAt(date: string, index: number): SlotRow | undefined {
  return db.prepare(`SELECT * FROM post_slots WHERE slot_date = ? AND slot_index = ?`).get(date, index) as
    | SlotRow
    | undefined;
}

export function schedulerStatus(): {
  enabled: boolean;
  slot_times: string[];
  today: { date: string; slots: SlotRow[]; published: number };
  next: SlotRow | undefined;
  platforms: { slug: string; ready: boolean }[];
} {
  const now = new Date();
  ensureSlots(now);
  const day = dayKey(now);
  const today = listSlots({ date: day, limit: 20 });
  const next = db.prepare(
    `SELECT * FROM post_slots
     WHERE status IN ('pending','claimed') AND scheduled_for >= ?
     ORDER BY scheduled_for ASC LIMIT 1`,
  ).get(utcStamp(now)) as SlotRow | undefined;

  return {
    enabled: schedulerEnabled(),
    slot_times: slotTimes(),
    today: {
      date: day,
      slots: today,
      published: today.filter((s) => s.status === "published").length,
    },
    next,
    platforms: listProviders()
      .filter((p) => MYSTERY_PLATFORMS.includes(p.slug as (typeof MYSTERY_PLATFORMS)[number]))
      .map((p) => ({
        slug: p.slug,
        ready: p.status === "VERIFIED-EXECUTED" && !!p.capabilities.imagePost,
      })),
  };
}

/**
 * Trend analysis over published slots: which category, platform and hour are
 * actually producing posts. With three slots a day and ~2 links this is thin
 * data, so it is labelled as what it is — a rotation report, not a forecast.
 * Claims of "best posting time" come only from links already in the store.
 */
export type TrendReport = {
  window_days: number;
  published: number;
  failed: number;
  by_platform: Record<string, number>;
  by_hour: Record<string, number>;
  top_links: { link_id: number; title: string; count: number }[];
  unused_links: { link_id: number; title: string }[];
  content_queue: number;
};

export function trendReport(windowDays = 7): TrendReport {
  const since = new Date(Date.now() - windowDays * 86_400_000);
  const rows = listSlots({ limit: 500 }).filter((s) => s.scheduled_for >= utcStamp(since));
  const by_platform: Record<string, number> = {};
  const by_hour: Record<string, number> = {};
  const perLink = new Map<number, number>();
  let published = 0;
  let failed = 0;

  for (const s of rows) {
    if (s.status === "published") published++;
    if (s.status === "failed") failed++;
    if (s.status !== "published") continue;
    if (s.platform) by_platform[s.platform] = (by_platform[s.platform] ?? 0) + 1;
    const hh = s.scheduled_for.slice(11, 13);
    by_hour[hh] = (by_hour[hh] ?? 0) + 1;
    if (s.link_id != null) perLink.set(s.link_id, (perLink.get(s.link_id) ?? 0) + 1);
  }

  const top_links = [...perLink.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([link_id, count]) => ({ link_id, title: getLink(link_id)?.product ?? `link ${link_id}`, count }));

  const unused = listLinks()
    .filter((l) => !perLink.has(l.id))
    .slice(-5)
    .map((l) => ({ link_id: l.id, title: l.product ?? l.short_url }));

  return {
    window_days: windowDays,
    published,
    failed,
    by_platform,
    by_hour,
    top_links,
    unused_links: unused,
    content_queue: listContent().length,
  };
}

let timer: NodeJS.Timeout | null = null;

/** Start the loop. Safe to call more than once; the old timer is replaced. */
export function startScheduler(): void {
  if (timer) clearInterval(timer);
  ensureHorizon(2);
  // P2.7 — load the last stored hook_perf immediately so pickHook has the
  // signal even before the day's first refresh tick.
  setHookPerf(metaGet(HOOK_PERF_KEY));
  // Warm the trends cache at boot so the first tick's captions have hashtags
  // (fire-and-forget — a dead provider never blocks startup).
  void fetchTopTrends(3).catch(() => {});
  timer = setInterval(() => {
    tick().catch((e) => {
      logActivity({
        level: "error",
        source: "system",
        event: "schedule.tick",
        message: String(e).slice(0, 400),
      });
    });
  }, TICK_MS);
  logActivity({ level: "info", source: "system", event: "schedule.start", message: `owner=${OWNER} tick=${TICK_MS}ms times=${slotTimes().join(",")}` });
}

export function stopScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
