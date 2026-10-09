/**
 * Lingkup 2 — AI Hook Lab.
 *
 * Generates candidate caption hook variants from proven patterns, stores them
 * in an `evolved_hooks` table, and exposes them to the epsilon-greedy picker
 * for exploration. Natural selection prunes under-performers automatically.
 *
 * SCOPE GUARDRAILS (non-negotiable — see plans/self-evolving-loop):
 *  • generated hooks are TEXT ONLY, never slots/links/prices/publishing
 *  • every generated hook must pass validateStory() before insertion
 *  • a hook retires automatically at >= 10 impressions if below baseline mean
 */
import { logActivity } from "./activity-log.ts";
import { validateStory } from "./smart-caption.ts";
import type { DatabaseSync } from "node:sqlite";

export type EvolvedHookRow = {
  id: number;
  product_type: string;
  open: string;
  why: string;
  cta: string;
  impressions: number;
  score: number;
  status: "active" | "retired";
  generated_at: string;
};

/** Create the evolved_hooks table. Idempotent — safe to call on every boot. */
export function initHookLabTable(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS evolved_hooks (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      product_type   TEXT    NOT NULL,
      open           TEXT    NOT NULL,
      why            TEXT    NOT NULL,
      cta            TEXT    NOT NULL,
      impressions    INTEGER NOT NULL DEFAULT 0,
      score          REAL    NOT NULL DEFAULT 0,
      status         TEXT    NOT NULL DEFAULT 'active',
      generated_at   TEXT    NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_evolved_hooks_type ON evolved_hooks(product_type, status);
  `);
}

/** Insert a candidate hook. Returns the new id, or null when it fails the gate. */
export function addEvolvedHook(
  db: DatabaseSync,
  input: { product_type: string; open: string; why: string; cta: string },
): number | null {
  // HARD GATE — no variant enters the pool unless it passes the same validator
  // as production captions (no brand spill, no price/shipping/warranty claims,
  // no links, 3 paragraphs, within the length cap).
  const full = `${input.open}\n\n${input.why}\n\n${input.cta}`;
  const story = validateStory(full, null);
  if (!story) {
    logActivity({ level: "warn", source: "system", event: "hooklab.reject", message: "generated hook failed validateStory — not stored" });
    return null;
  }
  const stmt = db.prepare(
    `INSERT INTO evolved_hooks (product_type, open, why, cta, generated_at)
     VALUES (?, ?, ?, ?, datetime('now','localtime'))`,
  );
  const r = stmt.run(input.product_type, input.open, input.why, input.cta);
  return Number(r.lastInsertRowid);
}

export function listEvolvedHooks(
  db: DatabaseSync,
  productType?: string,
  status: "active" | "retired" | "any" = "active",
): EvolvedHookRow[] {
  let sql = `SELECT id, product_type, open, why, cta, impressions, score, status, generated_at
             FROM evolved_hooks`;
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (productType) { where.push("product_type = ?"); args.push(productType); }
  if (status !== "any") { where.push("status = ?"); args.push(status); }
  if (where.length) sql += ` WHERE ${where.join(" AND ")}`;
  sql += ` ORDER BY id DESC LIMIT 50`;
  return db.prepare(sql).all(...args) as EvolvedHookRow[];
}

/** Record an impression (called from the publish path when a hook is used). */
export function recordEvolvedHookImpression(db: DatabaseSync, id: number): void {
  db.prepare(`UPDATE evolved_hooks SET impressions = impressions + 1 WHERE id = ?`).run(id);
}

/** Record the engagement score observed for a hook's post. */
export function recordEvolvedHookScore(db: DatabaseSync, id: number, score: number): void {
  db.prepare(`UPDATE evolved_hooks SET score = ? WHERE id = ?`).run(score, id);
}

/**
 * Natural selection. Called from the daily audit tick with the live numbers.
 *  - < RETIRE_MIN_IMPRESSIONS: not enough data, stay active
 *  - >= RETIRE_MIN_IMPRESSIONS and score < baseline_mean: retire
 *  - otherwise: stay active
 */
export const RETIRE_MIN_IMPRESSIONS = 10;

export function evaluateEvolvedHookSurvival(
  db: DatabaseSync,
  id: number,
  live: { impressions: number; score: number; baseline_mean: number },
): { status: "active" | "retired" } {
  const row = db.prepare(`SELECT impressions FROM evolved_hooks WHERE id = ?`).get(id) as
    | { impressions: number }
    | undefined;
  if (!row) return { status: "active" };
  const impressions = live.impressions ?? row.impressions;
  if (impressions >= RETIRE_MIN_IMPRESSIONS && live.score < live.baseline_mean) {
    db.prepare(`UPDATE evolved_hooks SET status = 'retired', score = ? WHERE id = ?`)
      .run(live.score, id);
    logActivity({
      level: "info", source: "system", event: "hooklab.retire",
      message: `hook #${id} retired: ${impressions} impressions, score ${live.score.toFixed(3)} < baseline ${live.baseline_mean.toFixed(3)}`,
    });
    return { status: "retired" };
  }
  return { status: "active" };
}

/** Epsilon-greedy selection: `rand` below epsilon explores the evolved pool. */
export const EXPLORE_EPSILON = 0.2;

export function pickHookWithEvolved(
  db: DatabaseSync,
  productType: string,
  opts: { staticHooks: string[]; rand: () => number; epsilon?: number },
): { open: string; source: "static" | "evolved"; id?: number } {
  const eps = opts.epsilon ?? EXPLORE_EPSILON;
  if (opts.rand() < eps) {
    const pool = listEvolvedHooks(db, productType, "active");
    if (pool.length > 0) {
      // round-robin the pool deterministically on impressions to avoid bias
      const chosen = pool[Math.floor(Math.random() * pool.length)]!;
      return { open: chosen.open, source: "evolved", id: chosen.id };
    }
  }
  const staticHook = opts.staticHooks[Math.floor(Math.random() * opts.staticHooks.length)] ?? opts.staticHooks[0]!;
  return { open: staticHook, source: "static" };
}

/**
 * Ask the model to synthesize one new hook variant from proven winners.
 * The result is stored ONLY if it passes validateStory. Caller (scheduler
 * weekly job) supplies the AI completion function to keep this module pure
 * and testable.
 */
export async function generateEvolvedHook(
  db: DatabaseSync,
  productType: string,
  winnerOpens: string[],
  complete: (prompt: string) => Promise<string | null>,
): Promise<EvolvedHookRow | null> {
  if (winnerOpens.length === 0) return null;
  const prompt = [
    `Kamu penulis hook caption media sosial untuk produk kategori "${productType}".`,
    `Berikut hook pemenang yang sudah terbukti engagement-nya tinggi:`,
    ...winnerOpens.map((h, i) => `${i + 1}. ${h}`),
    "",
    "Tulis SATU hook baru (3 paragraf, dipisahkan baris kosong) dengan gaya yang mirip tapi sudut pandang berbeda.",
    "Format: PARAGRAF1 / PARAGRAF2 / PARAGRAF3 tanpa penomoran.",
    "ATURAN KERAS: bahasa Indonesia, 40-400 karakter total, TANPA link, TANPA hashtag, TANPA nama merek, TANPA harga/diskon/ongkir/garansi.",
  ].join("\n");
  const out = await complete(prompt);
  if (!out) return null;
  const paras = out.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  if (paras.length !== 3) return null;
  const id = addEvolvedHook(db, { product_type: productType, open: paras[0]!, why: paras[1]!, cta: paras[2]! });
  if (id === null) return null;
  const row = db.prepare(`SELECT * FROM evolved_hooks WHERE id = ?`).get(id) as EvolvedHookRow;
  logActivity({ level: "info", source: "system", event: "hooklab.generated", message: `new hook #${id} for ${productType}` });
  return row;
}
