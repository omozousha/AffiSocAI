/**
 * Engagement Learning Engine — closed-loop feedback for caption generation.
 *
 * Metrics from IG/FB/Threads land in post_metrics. This module turns them
 * into a ranking that feeds back into smart-caption.ts generation:
 *
 *   1. ES (Engagement Score) weights actions by how hard they are to earn:
 *        views 1x, likes+saves 3x, comments 5x, shares/reposts 7x
 *   2. aggregateHookStats buckets ES per hook open-line (first caption line)
 *   3. getTopHooksForPrompt Bayesian-smoothes toward the global mean so a
 *      single viral post cannot crown a 1-post hook
 *   4. rankHooksEpsilonGreedy auto-rotates: 80% exploit the proven winner,
 *      20% explore a challenger — the only way out of a local optimum
 *
 * Pure functions only. No DB, no network — the caller supplies the rows.
 */
import { buildIdentity, detectType } from "./product-identity.ts";

/** Per-post metric keys, tolerant of the platform synonyms in the wild. */
export type MetricInput = Record<string, number | undefined>;

export interface MetricRow {
  body: string;
  metrics_json: string;
  product: string | null;
  kategori: string | null;
}

export interface HookAggregate {
  /** Sum of raw ES across every post that used this hook. */
  raw_score: number;
  /** Number of posts that used this hook. */
  posts: number;
}

export type HookStats = Record<string, HookAggregate>;

export interface RankedHook {
  hook: string;
  score: number;
  posts: number;
}

/** Bayesian prior weight toward the global mean (pseudo-posts). */
export const SMOOTH_PRIOR = 3;

/** Minimum posts a hook needs before it can win exploitation. */
export const MIN_SAMPLE = 3;

/**
 * Weighted engagement score for one post.
 *
 * Views are reach, not engagement — they earn the lowest weight. Comments and
 * shares are the expensive signals: a share broadcasts the post, a comment
 * means the viewer stopped. Those carry 7x and 5x.
 */
export function calculateEngagementScore(metrics: MetricInput): number {
  const views = metrics.views ?? metrics.reach ?? metrics.post_media_view ?? 0;
  const likes = metrics.likes ?? 0;
  const saves = metrics.saved ?? metrics.saves ?? 0;
  const comments = metrics.comments ?? metrics.replies ?? 0;
  const shares = metrics.shares ?? metrics.reposts ?? metrics.quotes ?? 0;
  return views + 3 * (likes + saves) + 5 * comments + 7 * shares;
}

/** Bucket ES per hook open-line. Malformed metrics rows are skipped. */
export function aggregateHookStats(rows: MetricRow[]): HookStats {
  const stats: HookStats = {};
  for (const r of rows) {
    let met: Record<string, number>;
    try {
      met = JSON.parse(r.metrics_json);
    } catch {
      continue;
    }
    const hook = (r.body || "").split("\n")[0].trim();
    if (!hook) continue;
    const s = (stats[hook] ??= { raw_score: 0, posts: 0 });
    s.posts += 1;
    s.raw_score += calculateEngagementScore(met);
  }
  return stats;
}

/**
 * Bayesian-smoothed score: (raw + prior * globalMean) / (posts + prior).
 *
 * A 1-post hook with a lucky 10k view needs SMOOTH_PRIOR more posts at that
 * level before its smoothed score stops being dragged toward the average.
 */
export function bayesianScore(agg: HookAggregate, globalMean: number): number {
  return (agg.raw_score + SMOOTH_PRIOR * globalMean) / (agg.posts + SMOOTH_PRIOR);
}

/**
 * Ranked hooks for prompt injection — top N by smoothed score.
 * Hooks below MIN_SAMPLE are excluded from the top ranks but still reported
 * so a challenger with promise is not invisible.
 */
export function getTopHooksForPrompt(rows: MetricRow[], topN: number = 3): RankedHook[] {
  const stats = aggregateHookStats(rows);
  const all = Object.values(stats);
  if (all.length === 0) return [];
  const totalPosts = all.reduce((a, s) => a + s.posts, 0);
  const totalScore = all.reduce((a, s) => a + s.raw_score, 0);
  const globalMean = totalScore / Math.max(1, totalPosts);

  const ranked: RankedHook[] = Object.entries(stats)
    .map(([hook, agg]) => ({
      hook,
      posts: agg.posts,
      score: Math.round(bayesianScore(agg, globalMean) * 100) / 100,
    }))
    .sort((a, b) => b.score - a.score || b.posts - a.posts);

  return ranked.slice(0, topN);
}

/**
 * Epsilon-greedy selection over an already-ranked list.
 *
 * exploit (1 - epsilon): return the top hook — the proven winner.
 * explore (epsilon): pick uniformly from the challengers — the escape hatch
 *   from a local optimum. Without it the engine would replay one hook until
 *   the audience fatigues on it, then have nothing better to switch to.
 *
 * `random` and `pickIndex` are injectable so tests stay deterministic.
 */
export function rankHooksEpsilonGreedy(
  ranked: RankedHook[],
  epsilon: number = 0.20,
  random: () => number = Math.random,
  pickIndex: (n: number) => number = (n) => Math.floor(Math.random() * n),
): string | null {
  if (ranked.length === 0) return null;
  if (ranked.length === 1) return ranked[0].hook;

  if (random() < epsilon) {
    // Explore: challengers only, never the current #1.
    const challengers = ranked.slice(1);
    if (challengers.length === 0) return ranked[0].hook;
    const idx = pickIndex(challengers.length);
    return challengers[idx].hook;
  }

  // Exploit: the proven winner. Hooks below MIN_SAMPLE cannot be exploited,
  // so early on the engine stays in rotation instead of over-fitting noise.
  const exploitable = ranked.find((r) => r.posts >= MIN_SAMPLE) ?? ranked[0];
  return exploitable.hook;
}

/**
 * Few-shot hook set for the prompt builder, chosen with epsilon-greedy.
 *
 * exploit (1-epsilon): the proven winner leads, next best fill the rest.
 * explore (epsilon): a challenger leads — the model still sees the top
 * performers as context, but the anchor slot rotates so no hook ever becomes
 * a permanent monopoly on the prompt.
 *
 * Returns [] for an empty ranking (cold start — caller sends no examples).
 */
export function chooseFewShotHooks(
  ranked: RankedHook[],
  epsilon: number = 0.20,
  count: number = 3,
  random: () => number = Math.random,
  pickIndex: (n: number) => number = (n) => Math.floor(Math.random() * n),
): string[] {
  if (ranked.length === 0) return [];
  const anchor = rankHooksEpsilonGreedy(ranked, epsilon, random, pickIndex);
  const out: string[] = [];
  if (anchor) out.push(anchor);
  for (const r of ranked) {
    if (out.length >= count) break;
    if (!out.includes(r.hook)) out.push(r.hook);
  }
  return out;
}

/** Product-type buckets keyed by detected type, for the daily refresh. */
export function groupRowsByType(rows: MetricRow[]): Record<string, MetricRow[]> {
  const out: Record<string, MetricRow[]> = {};
  for (const r of rows) {
    const type = detectType({
      product: r.product,
      kategori: r.kategori,
      shop: "",
    });
    (out[type] ??= []).push(r);
  }
  return out;
}
