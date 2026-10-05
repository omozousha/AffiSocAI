/**
 * P2.7 — learn which hook actually earns reach.
 *
 * pickHook used to rotate the hook library by slot index blindly: the
 * post_metrics loop collected reach but nothing fed it back into generation.
 * Daily, aggregate reach + engagement PER HOOK (first-line text) over a
 * rolling window into meta('hook_perf'); pickHook asks this module for the
 * best hook of the product type and falls back to rotation when there is no
 * signal yet (no metrics, or < MIN_SAMPLE posts per hook).
 *
 * Score = avg(reach + 2*(likes+comments+saved+shares)) per post, Bayesian-
 * smoothed toward the global average (3 pseudo-posts) so one lucky viral post
 * cannot dominate a 2-post hook forever.
 */
import { buildIdentity, detectType } from "./product-identity.ts";
export const HOOK_PERF_KEY = "hook_perf";
export const MIN_SAMPLE = 3;
const SMOOTH = 3; // pseudo-post weight toward the global mean

export type HookStat = { posts: number; score: number }; // score = sum of per-post raw
export type Perf = Record<string, Record<string, HookStat>>; // type -> open-line -> stat
/** One joined row: caption body, metrics JSON, product name, kategori. */
export type PerfRow = { b: string; m: string; p: string | null; k: string | null };

/** Aggregate metric rows into per-type, per-hook-open stats. Pure — no DB. */
export function aggregatePerf(rows: PerfRow[]): Perf {
  const agg: Perf = {};
  for (const r of rows) {
    let met: Record<string, number>;
    try {
      met = JSON.parse(r.m);
    } catch {
      continue;
    }
    const reach = met.reach ?? met.views ?? met.post_media_view ?? 0;
    const eng = (met.likes ?? 0) + (met.comments ?? 0) + (met.saved ?? 0) + (met.shares ?? 0);
    const open = (r.b || "").split("\n")[0].trim();
    if (!open) continue;
    const type = detectType(buildIdentity({ product: r.p, kategori: r.k, shop: null }));
    const t = (agg[type] ??= {});
    const s = (t[open] ??= { posts: 0, score: 0 });
    s.posts += 1;
    s.score += reach + 2 * eng;
  }
  return agg;
}

/**
 * Winning hook open-line for a product type, or null = keep rotating.
 * Hooks below MIN_SAMPLE posts never win; ties break on the bigger sample.
 * perfJson is the stored hook_perf meta value (may be null / corrupt).
 */
export function bestOpenFor(perfJson: string | null, type: string): string | null {
  if (!perfJson) return null;
  let perf: Perf;
  try {
    perf = JSON.parse(perfJson);
  } catch {
    return null;
  }
  const t = perf[type];
  if (!t || Object.keys(t).length === 0) return null;
  const all = Object.values(t);
  const totalPosts = all.reduce((a, s) => a + s.posts, 0);
  const globalMean = all.reduce((a, s) => a + s.score, 0) / Math.max(1, totalPosts);
  let best: { open: string; smooth: number; posts: number } | null = null;
  for (const [open, s] of Object.entries(t)) {
    if (s.posts < MIN_SAMPLE) continue;
    const smooth = (s.score + SMOOTH * globalMean) / (s.posts + SMOOTH);
    if (!best || smooth > best.smooth || (smooth === best.smooth && s.posts > best.posts)) {
      best = { open, smooth, posts: s.posts };
    }
  }
  return best?.open ?? null;
}
