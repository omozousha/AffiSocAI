/**
 * Analytics loop: pull IG/FB insights for published posts into post_metrics
 * so the Dashboard can rank which hook/category actually earns reach.
 * Rate discipline matters on this VPS (proven: unbounded composio spawns =
 * load 10+): one batch of <=6 per HOUR, meta-gated, best-effort, never
 * blocks posting. Posts that return empty metrics are left stale (fresh
 * IG posts legitimately have no insights for a while).
 */
import { logActivity } from "./activity-log.ts";

export async function pullMetricsBatch(): Promise<{ pulled: number }> {
  const { staleMetricsContentIds, upsertPostMetrics } = await import("./store.ts");
  const { listContent } = await import("./store.ts");
  const { getProvider } = await import("./registry.ts");
  const ids = staleMetricsContentIds(24, 6);
  if (ids.length === 0) return { pulled: 0 };
  const rows = listContent().filter((c) => ids.includes(c.id));
  let pulled = 0;
  for (const c of rows) {
    const p = getProvider(c.platform);
    if (!p?.getAnalytics) continue;
    try {
      const a = await p.getAnalytics(String(c.post_id));
      const nums = Object.values(a.metrics ?? {});
      if (nums.length === 0) continue; // leave stale, retry next hour
      upsertPostMetrics(c.id, c.platform, String(c.post_id), a.metrics);
      pulled++;
    } catch { /* transient; retry later */ }
  }
  if (pulled > 0) {
    logActivity({ level: "info", source: "system", event: "metrics.pull", message: `pulled ${pulled} post metrics` });
  }
  return { pulled };
}
