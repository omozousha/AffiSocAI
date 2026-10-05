/**
 * P2.8 — suggest the best posting hours from real reach data.
 *
 * Slot times are manual today (DEFAULT_SLOT_TIMES). post_metrics already
 * knows each post's reach; content.created_at is the publish moment (UTC).
 * Bucket reach per LOCAL hour (WIB = UTC+7) over a rolling window and rank.
 *
 * Pure module: rows in, ranked hours out — scheduler/API/tests feed it.
 * Suggestion is ADVISORY: the UI shows it, the operator applies it via the
 * existing /api/schedule/config. No auto-mutation of slot_times.
 */
export type InsightRow = { created_at: string; metrics: string }; // content.created_at UTC 'YYYY-MM-DD HH:MM:SS' + metrics JSON

export type HourStat = { hourLocal: string; posts: number; avgReach: number; totalReach: number };

const MIN_POSTS = 3; // one lucky post must not define "prime time"

function localHour(utcStampStr: string): string | null {
  // 'YYYY-MM-DD HH:MM:SS' (UTC) -> 'HH' WIB (+7); stamp format proven in store/scheduler
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}):/.exec(utcStampStr || "");
  if (!m) return null;
  const h = (Number(m[2]) + 7) % 24;
  return String(h).padStart(2, "0");
}

/** Rank local hours by average reach (smoothed toward global mean). */
export function bestHours(rows: InsightRow[], windowDays = 30, limit = 3): HourStat[] {
  const cutoff = new Date(Date.now() - windowDays * 86_400_000).toISOString().slice(0, 19).replace("T", " ");
  const bucket = new Map<string, { posts: number; reach: number }>();
  for (const r of rows) {
    if ((r.created_at || "") < cutoff) continue;
    const h = localHour(r.created_at);
    if (!h) continue;
    let met: Record<string, number>;
    try {
      met = JSON.parse(r.metrics);
    } catch {
      continue;
    }
    const reach = met.reach ?? met.views ?? met.post_media_view ?? 0;
    const b = bucket.get(h) ?? { posts: 0, reach: 0 };
    b.posts += 1;
    b.reach += reach;
    bucket.set(h, b);
  }
  const allPosts = [...bucket.values()].reduce((a, b) => a + b.posts, 0);
  const allReach = [...bucket.values()].reduce((a, b) => a + b.reach, 0);
  const globalAvg = allReach / Math.max(1, allPosts);
  const SMOOTH = 2;
  const stats: HourStat[] = [...bucket.entries()].map(([hourLocal, b]) => ({
    hourLocal,
    posts: b.posts,
    totalReach: b.reach,
    // Bayesian toward global mean so thin hours don't top the list
    avgReach: (b.reach + SMOOTH * globalAvg) / (b.posts + SMOOTH),
  }));
  return stats.filter((s) => s.posts >= MIN_POSTS).sort((a, b) => b.avgReach - a.avgReach).slice(0, limit);
}

/** Format 'HH' as 'HH:30' near-prime suggestion (posting lands on the half hour by convention). */
export function suggestSlotTimes(stats: HourStat[]): string[] {
  return stats.map((s) => `${s.hourLocal}:30`);
}
