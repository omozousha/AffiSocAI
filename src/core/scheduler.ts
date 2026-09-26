/**
 * Posting scheduler — 3 slots a day, run in-process.
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

import { listLinks, getLink, addContent, listContent, setContentStatus } from "./store.ts";
import { buildMysteryCaption, MYSTERY_PLATFORMS } from "./mystery-caption.ts";
import { listProviders } from "./registry.ts";
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
    created_at     TEXT    NOT NULL DEFAULT (datetime('now', 'subsec')),
    UNIQUE (slot_date, slot_index)
  );
  CREATE INDEX IF NOT EXISTS idx_slots_due ON post_slots(status, scheduled_for);
  CREATE TABLE IF NOT EXISTS scheduler_meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

/** Local-time HH:MM -> slot index. Default 09.00 / 13.00 / 19.00 WIB. */
export const DEFAULT_SLOT_TIMES = ["09:00", "13:00", "19:00"] as const;

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
  const ins = db.prepare(
    `INSERT INTO post_slots (slot_date, slot_index, scheduled_for)
     VALUES (?, ?, ?)
     ON CONFLICT(slot_date, slot_index) DO NOTHING`,
  );
  let created = 0;
  for (let i = 0; i < times.length; i++) {
    const when = atTime(day, times[i]!);
    const r = ins.run(day, i, utcStamp(when));
    created += r.changes ?? 0;
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
 * Pick which link a slot should post.
 *
 * Rotation, not recency: the most recently posted link is chosen among the
 * pool, so posting the same product every slot is avoided. Links without an
 * image are excluded — an unmedia'd post is rejected higher up anyway, and
 * skipping them here keeps the log honest about *why* nothing was posted.
 */
export function pickLink(): ReturnType<typeof getLink> {
  const links = listLinks().filter((l) => !!l.image_url);
  if (links.length === 0) return undefined;

  const lastByLink = new Map<number, string>();
  for (const s of listSlots({ limit: 200 })) {
    if (s.link_id == null || s.status !== "published") continue;
    const prev = lastByLink.get(s.link_id);
    if (!prev || s.scheduled_for > prev) lastByLink.set(s.link_id, s.scheduled_for);
  }
  const used = [...lastByLink.entries()].sort((a, b) => (a[1] < b[1] ? 1 : -1));
  const oldestUsedId = used.length ? used[used.length - 1]![0] : null;
  if (oldestUsedId != null) {
    const l = getLink(oldestUsedId);
    if (l?.image_url) return l;
  }
  // Nothing posted yet, or every posted link is gone: newest first.
  return links[links.length - 1];
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

type PreparedPost = {
  link_id: number;
  platform: PlatformKey;
  draft: ReturnType<typeof buildMysteryCaption>;
  media_url: string;
  content_id: number;
};

/** Build caption + persist a draft row, or throw. Never publishes. */
function preparePost(slot: SlotRow): PreparedPost {
  const link = pickLink();
  if (!link) throw new Error("no link with an image available to post");

  const targets = publishablePlatforms();
  if (targets.length === 0) {
    throw new Error(
      "no publishable platform: every provider is disconnected or cannot post media",
    );
  }
  const target = targets[(slot.attempts - 1) % targets.length]!;

  const draft = buildMysteryCaption(target.platform, {
    short_url: link.short_url,
    resolved_url: link.resolved_url,
    shopee_shop_id: link.shopee_shop_id,
    shopee_item_id: link.shopee_item_id,
    shop: link.shop,
    product: link.product,
    image_url: link.image_url,
  });

  const mediaUrl = absoluteForProvider(link.image_url!);
  if (!mediaUrl) throw new Error("recreated image has no fetchable URL");

  const row = addContent({
    link_id: link.id,
    platform: target.platform,
    kind: "image",
    body: draft.body,
    media_url: mediaUrl,
    first_comment: null,
  });

  return { link_id: link.id, platform: target.platform, draft, media_url: mediaUrl, content_id: row.id };
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

/** Run one claimed slot end to end. Returns the slot after its outcome is stored. */
export async function runSlot(slot: SlotRow): Promise<SlotRow> {
  let prepared: PreparedPost;
  try {
    prepared = preparePost(slot);
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

  const provider = providerFor(prepared.platform);
  if (!provider) {
    unclaimSlot(slot.id, `provider ${prepared.platform} not registered`);
    return getSlot(slot.id)!;
  }

  const content: SocialContent = {
    text: prepared.draft.body,
    mediaUrl: prepared.media_url,
    mediaKind: "image",
    link: linkShort(prepared.link_id),
  };

  const t0 = Date.now();
  try {
    const check = await provider.validateContent(content);
    if (!check.ok) {
      setContentStatus(prepared.content_id, "rejected", { error: check.errors.join("; ") });
      finishSlot(slot.id, { status: "failed", error: check.errors.join("; ") });
      logActivity({
        level: "warn",
        source: "system",
        event: "schedule.reject",
        message: check.errors.join("; "),
        meta: { platform: prepared.platform, content_id: prepared.content_id },
      });
      return getSlot(slot.id)!;
    }

    const res = await provider.publish(content);
    const ms = Date.now() - t0;

    if (res.ok) {
      setContentStatus(prepared.content_id, "published", {
        post_id: res.postId ?? null,
        post_url: res.url ?? null,
        error: null,
      });
      finishSlot(slot.id, {
        status: "published",
        link_id: prepared.link_id,
        platform: prepared.platform,
        content_id: prepared.content_id,
        post_id: res.postId ?? null,
        post_url: res.url ?? null,
        error: null,
      });
      logActivity({
        level: "info",
        source: "system",
        event: "schedule.publish",
        status: 200,
        duration_ms: ms,
        message: res.url || res.postId || "published",
        meta: {
          platform: prepared.platform,
          link_id: prepared.link_id,
          content_id: prepared.content_id,
          slot_date: slot.slot_date,
          slot_index: slot.slot_index,
        },
      });
    } else {
      setContentStatus(prepared.content_id, "rejected", { error: res.error ?? null });
      // A provider error is usually transient (token refresh, rate limit), so
      // hand the slot back and let a later tick try again — unless it has
      // already burned its attempts, then it stays failed.
      const err = (res.error || "publish failed").slice(0, 400);
      finishSlot(slot.id, {
        status: slot.attempts > 3 ? "failed" : "pending",
        error: err,
        link_id: prepared.link_id,
        platform: prepared.platform,
        content_id: prepared.content_id,
      });
      logActivity({
        level: "error",
        source: "system",
        event: "schedule.publish",
        status: 502,
        duration_ms: ms,
        message: err,
        meta: { platform: prepared.platform, content_id: prepared.content_id, attempts: slot.attempts },
      });
    }
  } catch (e) {
    const err = String(e).slice(0, 400);
    unclaimSlot(slot.id, err);
    setContentStatus(prepared.content_id, "rejected", { error: err });
    logActivity({
      level: "error",
      source: "system",
      event: "schedule.error",
      message: err,
      meta: { platform: prepared.platform, content_id: prepared.content_id },
    });
  }
  return getSlot(slot.id)!;
}

function linkShort(id: number): string {
  return getLink(id)?.short_url ?? "";
}

/** One tick: top up slots, then publish everything due. */
export async function tick(now = new Date()): Promise<{ ran: SlotRow[]; created: number }> {
  const created = ensureSlots(now);
  if (!schedulerEnabled()) return { ran: [], created };

  const due = claimableSlots(now);
  const ran: SlotRow[] = [];
  for (const slot of due) {
    if (!claimSlot(slot.id, OWNER)) continue; // lost the race
    ran.push(await runSlot(slot));
  }
  return { ran, created };
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
    platforms: MYSTERY_PLATFORMS.map((slug) => {
      const p = listProviders().find((v) => v.slug === slug);
      return { slug, ready: !!p && p.status === "VERIFIED-EXECUTED" && !!p.capabilities.imagePost };
    }),
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
