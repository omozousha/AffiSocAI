/**
 * Activity log — node:sqlite, zero dependencies.
 *
 * Appends-worst-ial (append-only) events into `activity_log` in the same
 * database as links/content. Any request can log; the /api/logs endpoints
 * only read. Nothing here writes to a request's response path — a logging
 * failure must never break the thing being logged, so every function
 * swallows its own errors.
 */

import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.AFFILIATE_DB || join(HERE, "..", "..", "data", "affiliate.db");

export type ActivityLevel = "info" | "warn" | "error";
export type ActivitySource = "api" | "system" | "ui";

export type ActivityRow = {
  id: number;
  ts: string;
  level: ActivityLevel;
  source: ActivitySource;
  event: string;
  method: string | null;
  path: string | null;
  status: number | null;
  duration_ms: number | null;
  message: string | null;
  meta: Record<string, unknown> | null;
};

mkdirSync(dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS activity_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    ts          TEXT    NOT NULL DEFAULT (datetime('now', 'subsec')),
    level       TEXT    NOT NULL DEFAULT 'info',
    source      TEXT    NOT NULL DEFAULT 'api',
    event       TEXT    NOT NULL,
    method      TEXT,
    path        TEXT,
    status      INTEGER,
    duration_ms INTEGER,
    message     TEXT,
    meta        TEXT,
    idx         INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_activity_ts ON activity_log(ts DESC);
  CREATE INDEX IF NOT EXISTS idx_activity_level ON activity_log(level);
`);

const ins = db.prepare(`
  INSERT INTO activity_log (level, source, event, method, path, status, duration_ms, message, meta)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

export type LogInput = {
  level?: ActivityLevel;
  source?: ActivitySource;
  event: string;
  method?: string | null;
  path?: string | null;
  status?: number | null;
  duration_ms?: number | null;
  message?: string | null;
  meta?: Record<string, unknown> | null;
};

/** Fire-and-forget. Never throws. */
export function logActivity(input: LogInput): void {
  try {
    ins.run(
      input.level ?? "info",
      input.source ?? "api",
      input.event,
      input.method ?? null,
      input.path ?? null,
      input.status ?? null,
      input.duration_ms ?? null,
      input.message ?? null,
      input.meta ? JSON.stringify(input.meta) : null,
    );
  } catch {
    /* logging must never take down the caller */
  }
}

export type LogQuery = {
  limit?: number;
  offset?: number;
  level?: ActivityLevel | ActivityLevel[];
  source?: ActivitySource;
  search?: string;
  method?: string;
  path_like?: string;
};

function parseMeta(row: Record<string, unknown>): ActivityRow {
  let meta: Record<string, unknown> | null = null;
  if (typeof row.meta === "string" && row.meta) {
    try {
      meta = JSON.parse(row.meta);
    } catch {
      meta = { raw: row.meta };
    }
  }
  return { ...(row as unknown as ActivityRow), meta };
}

export function listActivity(q: LogQuery = {}): ActivityRow[] {
  const limit = Math.min(Math.max(Number(q.limit ?? 200), 1), 500);
  const offset = Math.max(Number(q.offset ?? 0), 0);
  const where: string[] = [];
  const args: unknown[] = [];

  if (q.level) {
    const levels = Array.isArray(q.level) ? q.level : [q.level];
    where.push(`level IN (${levels.map(() => "?").join(",")})`);
    args.push(...levels);
  }
  if (q.source) {
    where.push("source = ?");
    args.push(q.source);
  }
  if (q.method) {
    where.push("method = ?");
    args.push(q.method.toUpperCase());
  }
  if (q.path_like) {
    where.push("path LIKE ? ESCAPE '\\'");
    args.push(`%${q.path_like.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
  }
  if (q.search) {
    where.push("(message LIKE ? ESCAPE '\\' OR event LIKE ? ESCAPE '\\' OR path LIKE ? ESCAPE '\\' OR meta LIKE ? ESCAPE '\\')");
    const s = `%${q.search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    args.push(s, s, s, s);
  }

  const sql =
    `SELECT id, ts, level, source, event, method, path, status, duration_ms, message, meta
     FROM activity_log${where.length ? ` WHERE ${where.join(" AND ")}` : ""}
     ORDER BY id DESC LIMIT ? OFFSET ?`;
  const rows = db.prepare(sql).all(...args, limit, offset) as unknown as Array<Record<string, unknown>>;
  return rows.map(parseMeta);
}

export function activityStats(): { total: number; error: number; warn: number; info: number; last_hour: number } {
  const one = db
    .prepare(`SELECT COUNT(*) AS n FROM activity_log WHERE ts > datetime('now','-1 hour')`)
    .get() as unknown as { n: number };
  const by = db
    .prepare(`SELECT level, COUNT(*) AS n FROM activity_log GROUP BY level`)
    .all() as unknown as Array<{ level: ActivityLevel; n: number }>;
  const count = (l: ActivityLevel) => by.find((r) => r.level === l)?.n ?? 0;
  return {
    total: by.reduce((s, r) => s + r.n, 0),
    error: count("error"),
    warn: count("warn"),
    info: count("info"),
    last_hour: one.n,
  };
}

/** Rows with id greater than `sinceId`, newest first — used by the SSE stream. */
export function listActivitySince(sinceId: number, limit = 50): ActivityRow[] {
  try {
    const rows = db
      .prepare(
        `SELECT id, ts, level, source, event, method, path, status, duration_ms, message, meta
         FROM activity_log WHERE id > ? ORDER BY id DESC LIMIT ?`,
      )
      .all(sinceId, Math.min(Math.max(limit, 1), 200)) as unknown as Array<Record<string, unknown>>;
    return rows.map(parseMeta);
  } catch {
    return [];
  }
}

/** Highest id currently stored — the SSE stream's starting cursor. */
export function dbLogMaxId(): number {
  const r = db.prepare(`SELECT MAX(id) AS n FROM activity_log`).get() as unknown as { n: number | null };
  return r.n ?? 0;
}

/** Trim to `keep` newest rows so the file cannot grow unbounded. */
export function pruneActivity(keep = 5000): number {
  try {
    const r = db
      .prepare(`DELETE FROM activity_log WHERE id NOT IN (SELECT id FROM activity_log ORDER BY id DESC LIMIT ?)`)
      .run(keep) as unknown as { changes: number };
    return r.changes;
  } catch {
    return 0;
  }
}
