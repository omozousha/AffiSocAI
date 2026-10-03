/**
 * One-off (repeatable) cleanup: rewrite every UNPUBLISHED content row whose
 * body still carries a brand, a shop slug, a product name, or the "gratis
 * ongkir" claim, using the current caption engine.
 *
 * Published rows are left alone on purpose — they are already live on the
 * platform and their captions cannot be rewritten from here.
 *
 * Run: node --experimental-strip-types scripts/backfill-captions.ts [--dry]
 */
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { getLink } from "../src/core/store.ts";
import { buildMysteryCaption, MYSTERY_PLATFORMS } from "../src/core/mystery-caption.ts";

const SPILL = /\bopaanlp\b|\bcosmo\b|#shopee\b|\bshopee\b|gratis ongkir|\bdari\s+[A-Za-z0-9_-]*\d[A-Za-z0-9_-]*\b|\bdi\s+[A-Za-z0-9_-]*\d[A-Za-z0-9_-]*\b|Jual\s/i;

const dry = process.argv.includes("--dry");
const HERE = dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(join(HERE, "..", "data", "affiliate.db"));

const rows = db
  .prepare(`SELECT id, link_id, platform FROM content WHERE status != 'published' AND link_id IS NOT NULL`)
  .all() as { id: number; link_id: number; platform: string }[];

let rewritten = 0;
for (const r of rows) {
  const body = db.prepare(`SELECT body FROM content WHERE id = ?`).get(r.id) as { body: string } | undefined;
  if (!body || !SPILL.test(body.body)) continue;
  const link = getLink(r.link_id);
  if (!link) continue;
  const idx = Number(link.published_count ?? 0);
  const kind = (MYSTERY_PLATFORMS as readonly string[]).includes(r.platform) ? r.platform : "instagram";
  const draft = buildMysteryCaption(kind as never, link as never, idx);
  if (SPILL.test(draft.body)) {
    console.log(`skip ${r.id}: engine output still matches SPILL`);
    continue;
  }
  if (dry) {
    console.log(`DRY ${r.id} (${r.platform}) -> ${draft.body.split("\n")[0].slice(0, 60)}`);
  } else {
    db.prepare(`UPDATE content SET body = ?, updated_at = datetime('now') WHERE id = ?`).run(draft.body, r.id);
    console.log(`rewrote ${r.id} (${r.platform})`);
  }
  rewritten++;
}

const still = rows
  .map((r) => {
    const b = db.prepare(`SELECT body FROM content WHERE id = ?`).get(r.id) as { body: string } | undefined;
    return b && SPILL.test(b.body) ? r.id : null;
  })
  .filter(Boolean);
console.log(`${dry ? "would rewrite" : "rewritten"}: ${rewritten} | still spilling: ${still.join(",") || "none"}`);
