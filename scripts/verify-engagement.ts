/**
 * One-shot verification: run the learning engine over the REAL post_metrics
 * table and print what smart-caption would receive as few-shot examples.
 * Not part of the runtime path — manual check only.
 */
import { DatabaseSync } from "node:sqlite";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getTopHooksForPrompt, chooseFewShotHooks } from "../src/core/engagement-engine.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const db = new DatabaseSync(join(root, "data", "affiliate.db"));

const rows = db
  .prepare(
    `SELECT c.body b, m.metrics m, l.product p, l.kategori k
     FROM post_metrics m JOIN content c ON c.id = m.content_id
     LEFT JOIN links l ON l.id = c.link_id
     WHERE c.status = 'published' AND c.created_at > datetime('now','-30 days')`,
  )
  .all() as unknown as { b: string; m: string; p: string | null; k: string | null }[];

const metricRows = rows.map((r) => ({ body: r.b, metrics_json: r.m, product: r.p, kategori: r.k }));
const top = getTopHooksForPrompt(metricRows, 5);
console.log(`metric rows: ${rows.length}`);
console.log("top hooks (smoothed):");
for (const h of top) console.log(`  ${h.score.toFixed(1)} (${h.posts} posts) ${h.hook.slice(0, 60)}`);
console.log("few-shot exploit path:", chooseFewShotHooks(top, 0.2, 3, () => 0.9));
console.log("few-shot explore path:", chooseFewShotHooks(top, 0.2, 3, () => 0.05, () => 0));
