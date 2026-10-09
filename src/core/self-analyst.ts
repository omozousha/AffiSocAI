/**
 * Lingkup 1 — Self-Analyst: autonomous self-audit of the publishing + caption
 * pipeline. Produces a deterministic JSON snapshot and (optionally) AI text
 * recommendations. READ-ONLY guarantees:
 *   • it never mutates slots, links, or config
 *   • AI only writes recommendation strings, never executes them
 *   • every number is derived from real DB rows, not fabricated
 * Result lives in scheduler_meta['self_audit_latest'] + activity_log.
 */
import { listActivity, logActivity } from "./activity-log.ts";
import { metricsWithPostTime } from "./store.ts";

export type AuditWindow = "24h" | "7d" | "30d";

export type AuditPublishing = { publishes: number; failures: number; composio_ok: number; composio_failed: number };
export type AuditValidator = { rejects: number; top_reasons: { reason: string; count: number }[] };
export type AuditEngagement = {
  post_count: number; total_views: number; total_likes: number; total_comments: number;
  total_shares: number; total_replies: number; avg_views: number; avg_likes: number;
};
export type AuditSummary = {
  window: AuditWindow;
  timestamp: string;
  publishing: AuditPublishing;
  validator: AuditValidator;
  engagement: AuditEngagement;
  recommendations: string[];
  source: "heuristic" | "ai";
};

const HOURS: Record<AuditWindow, number> = { "24h": 24, "7d": 168, "30d": 720 };
export const AUDIT_META_KEY = "self_audit_latest";
export const AUDIT_EVENT = "system.self_audit";
const ROUTER_BASE = process.env.AFFILIATE_ROUTER_BASE_URL || "https://router2nd.realpaytrans.my.id/v1";
const SELF_AUDIT_MODEL = (process.env.AFFILIATE_SELF_AUDIT_MODEL || "ag/gemini-3.8-flash").trim();

/** Aggregate real rows into an audit summary. Pure: rows in, summary out. */
export function generateAuditSummary(
  logs: { event: string; message: string; ts: string }[],
  metricsRows: { created_at?: string; metrics: string }[],
  window: AuditWindow = "24h",
): AuditSummary {
  const hours = HOURS[window];
  const cutoff = new Date(Date.now() - hours * 3600_000).toISOString().slice(0, 19).replace("T", " ");
  const recent = logs.filter((l) => (l.ts || "") >= cutoff);

  const publishing: AuditPublishing = { publishes: 0, failures: 0, composio_ok: 0, composio_failed: 0 };
  const validatorRejects = new Map<string, number>();

  for (const l of recent) {
    if (l.event === "schedule.publish") publishing.publishes++;
    else if (l.event === "schedule.failed") publishing.failures++;
    else if (l.event === "composio.ok") publishing.composio_ok++;
    else if (l.event === "composio.failed") publishing.composio_failed++;
    else if (l.event === "caption.reject") {
      const bracket = (l.message || "").match(/\(([^)]+)\)/);
      const reason = bracket ? bracket[1] : "unknown";
      validatorRejects.set(reason, (validatorRejects.get(reason) || 0) + 1);
    }
  }

  const top_reasons = [...validatorRejects.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const engagement: AuditEngagement = {
    post_count: 0, total_views: 0, total_likes: 0, total_comments: 0,
    total_shares: 0, total_replies: 0, avg_views: 0, avg_likes: 0,
  };
  for (const m of metricsRows) {
    let met: Record<string, number>;
    try { met = JSON.parse(m.metrics); } catch { continue; }
    engagement.post_count++;
    engagement.total_views += Number(met.views ?? met.reach ?? met.post_media_view ?? 0) || 0;
    engagement.total_likes += Number(met.likes ?? met.like_count ?? met.likes_count ?? 0) || 0;
    engagement.total_comments += Number(met.comments ?? met.comments_count ?? 0) || 0;
    engagement.total_shares += Number(met.shares ?? met.shares_count ?? met.repost_count ?? 0) || 0;
    engagement.total_replies += Number(met.replies ?? met.comment_replies ?? 0) || 0;
  }
  if (engagement.post_count > 0) {
    engagement.avg_views = Math.round(engagement.total_views / engagement.post_count);
    engagement.avg_likes = Math.round(engagement.total_likes / engagement.post_count);
  }

  const rejects = [...validatorRejects.values()].reduce((a, b) => a + b, 0);
  const recommendations = synthesizeHeuristicInsights({
    publishing,
    validator: { rejects, top_reasons },
    engagement,
  });

  return {
    window,
    timestamp: new Date().toISOString().slice(0, 19).replace("T", " "),
    publishing,
    validator: { rejects, top_reasons },
    engagement,
    recommendations,
    source: "heuristic",
  };
}

/** Deterministic fallback when AI endpoint is unavailable — always succeeds. */
export function synthesizeHeuristicInsights(s: {
  publishing: { publishes: number; failures: number; composio_failed: number; composio_ok: number };
  validator: { rejects: number; top_reasons: { reason: string; count: number }[] };
  engagement: { post_count: number; total_views: number; total_likes: number };
}): string[] {
  const out: string[] = [];
  const total = s.publishing.publishes + s.publishing.failures || 1;

  const failRate = s.publishing.failures / total;
  if (failRate === 0) out.push("Publishing lancar: 0 gagal pada window ini. Token composio aktif, tidak ada kebutuhan re-login.");
  else out.push(`Publishing ${failRate > 0.05 ? "perlu perhatian" : "masih stabil"}: ${s.publishing.failures} gagal dari ${total} percobaan (${(failRate * 100).toFixed(1)}%).`);

  if (s.validator.rejects === 0) out.push("Validator bersih: 0 caption reject. AI story lolos penuh — whitelist fungsi efektif.");
  else if (s.validator.top_reasons[0]?.reason?.startsWith("spill:")) out.push(`Validator memblokir ${s.validator.rejects} caption karena brand spill (${s.validator.top_reasons[0].reason}). Jika kata tersebut deskripsi fungsi (bukan merk), tambah ke whitelist GENERIC.`);
  else out.push(`Validator menolak ${s.validator.rejects} caption (alasan utama: ${s.validator.top_reasons[0]?.reason ?? "unknown"}). Tinjau aturan validator jika alasan tersebut kata fungsi yang sah.`);

  if (s.engagement.post_count === 0) out.push("Belum ada metrics engagement yang terkumpul. Sistem masih dalam tahap pengumpulan data.");
  else {
    const avgV = Math.round(s.engagement.total_views / s.engagement.post_count);
    const avgL = Math.round(s.engagement.total_likes / s.engagement.post_count);
    out.push(`Engagement ${s.engagement.post_count} post: rata-rata ${avgV} views, ${avgL} likes per post.`);
  }
  return out;
}

/** Optional AI polish of the 3 recommendations. Null on any failure — the
 *  heuristic lines above remain the floor. AI output is TEXT ONLY. */
export async function aiRecommendations(summary: AuditSummary): Promise<string[] | null> {
  const key = process.env.AFFILIATE_ROUTER_KEY;
  if (!key || process.env.AFFILIATE_SELF_AUDIT_AI === "0") return null;
  const prompt = [
    "Kamu analis opsional untuk sistem auto-posting affiliate. Data audit JSON:",
    JSON.stringify({ publishing: summary.publishing, validator: summary.validator, engagement: summary.engagement }),
    "Tulis TEPAT 3 baris rekomendasi operasional (bahasa Indonesia, tanpa pembuka/penutup, tanpa markdown).",
    "ATURAN: hanya rekomendasi TEKS — jangan mengklaim sudah melakukan aksi apapun.",
  ].join("\n");
  try {
    const r = await fetch(`${ROUTER_BASE}/chat/completions`, {
      method: "POST",
      signal: AbortSignal.timeout(25_000),
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: SELF_AUDIT_MODEL,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.4, max_tokens: 300, stream: false,
      }),
    });
    if (!r.ok) return null;
    const txt = await r.text();
    let out = "";
    try {
      const j = JSON.parse(txt) as { choices?: { message?: { content?: string } }[] };
      out = j.choices?.[0]?.message?.content ?? "";
    } catch { /* SSE or junk — treat as failure */ }
    const lines = out.split("\n").map((l) => l.replace(/^[-*\d.)\s]+/, "").trim()).filter((l) => l.length > 15);
    return lines.length >= 3 ? lines.slice(0, 3) : null;
  } catch {
    return null;
  }
}

/** Full audit run: gather real rows -> summary -> AI polish (best-effort)
 *  -> store in meta + log. Injected meta functions avoid scheduler circular deps. */
export async function runSelfAudit(
  metaFns: { get: (k: string) => string | null; set: (k: string, v: string) => void },
  window: AuditWindow = "24h",
): Promise<AuditSummary> {
  const logs = listActivity({ limit: 500 }).map((l) => ({ event: l.event, message: l.message ?? "", ts: l.ts }));
  const metrics = metricsWithPostTime(HOURS[window] / 24 + 1);
  const summary = generateAuditSummary(logs, metrics, window);
  const ai = await aiRecommendations(summary);
  if (ai) { summary.recommendations = ai; summary.source = "ai"; }
  metaFns.set(AUDIT_META_KEY, JSON.stringify(summary));
  logActivity({
    level: "info", source: "system", event: AUDIT_EVENT,
    message: `self-audit (${window}): ${summary.publishing.publishes} publish / ${summary.validator.rejects} reject / ${summary.engagement.total_views} views — ${summary.recommendations.length} rekomendasi (${summary.source})`,
  });
  return summary;
}
