/**
 * One-shot check: does staleMetricsContentIds surface Threads posts, or is
 * Threads invisible to the analytics pull? Manual verification only.
 */
import { DatabaseSync } from "node:sqlite";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { staleMetricsContentIds } from "../src/core/store.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const db = new DatabaseSync(join(root, "data", "affiliate.db"));

const byPlat = db
  .prepare(
    `SELECT platform, count(*) n,
            sum(post_id IS NOT NULL AND post_id <> '') has_pid
     FROM content WHERE status='published' GROUP BY platform`,
  )
  .all();
console.log("published by platform:", byPlat);

const stale = staleMetricsContentIds(0, 500);
if (stale.length > 0) {
  const rows = db
    .prepare(`SELECT platform, count(*) n FROM content WHERE id IN (${stale.map(() => "?").join(",")}) GROUP BY platform`)
    .all(...stale);
  console.log(`stale(0h, limit 500): ${stale.length} ids`, rows);
} else {
  console.log("stale(0h, limit 500): 0 ids");
}
