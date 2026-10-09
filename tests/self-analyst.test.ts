import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateAuditSummary, synthesizeHeuristicInsights } from "../src/core/self-analyst.ts";

// timestamps must be relative to now — the audit filters by a real 24h cutoff
const tsAgo = (min: number) => new Date(Date.now() - min * 60_000).toISOString().slice(0, 19).replace("T", " ");

describe("Lingkup 1 — Self-Analyst Deterministic Audit", () => {
  it("computes accurate audit metrics from mock activity & metric rows", () => {
    const mockLogs = [
      { event: "schedule.publish", message: "published slot 10", ts: tsAgo(60) },
      { event: "schedule.publish", message: "published slot 11", ts: tsAgo(30) },
      { event: "caption.reject", message: "AI text failed validator (spill:xyz)", ts: tsAgo(120) },
      { event: "composio.failed", message: "rate limit error", ts: tsAgo(180) },
      { event: "composio.ok", message: "success", ts: tsAgo(240) },
      // outside window — must be ignored
      { event: "schedule.publish", message: "old", ts: tsAgo(60 * 30) },
    ];
    const mockMetrics = [
      { platform: "instagram", metrics: JSON.stringify({ views: 100, likes: 10, comments: 2 }) },
      { platform: "facebook", metrics: JSON.stringify({ views: 250, likes: 25, shares: 3 }) },
      { platform: "threads", metrics: JSON.stringify({ views: 80, likes: 5, replies: 1 }) },
      { platform: "instagram", metrics: "not-json" }, // must be skipped, not crash
    ];

    const summary = generateAuditSummary(mockLogs, mockMetrics, "24h");

    assert.equal(summary.publishing.publishes, 2);
    assert.equal(summary.publishing.composio_failed, 1);
    assert.equal(summary.publishing.composio_ok, 1);
    assert.equal(summary.validator.rejects, 1);
    assert.equal(summary.validator.top_reasons[0]?.reason, "spill:xyz");
    assert.equal(summary.validator.top_reasons[0]?.count, 1);
    assert.equal(summary.engagement.post_count, 3);
    assert.equal(summary.engagement.total_views, 430);
    assert.equal(summary.engagement.total_likes, 40);
    assert.equal(summary.engagement.total_comments, 2);
    assert.equal(summary.engagement.total_shares, 3);
    assert.equal(summary.engagement.total_replies, 1);
    assert.equal(summary.engagement.avg_views, 143);
    assert.equal(summary.recommendations.length, 3);
  });

  it("synthesizes sensible heuristic recommendations when healthy", () => {
    const recs = synthesizeHeuristicInsights({
      publishing: { publishes: 12, failures: 0, composio_failed: 0, composio_ok: 50 },
      validator: { rejects: 0, top_reasons: [] },
      engagement: { post_count: 12, total_views: 1200, total_likes: 120 },
    });
    assert.equal(recs.length, 3);
    assert.ok(recs.some((r) => /lancar/i.test(r)), "health line reports clean publishing");
    assert.ok(recs.some((r) => /validator/i.test(r)), "validator line present");
    assert.ok(recs.some((r) => /engagement/i.test(r)), "engagement line present");
  });

  it("flags spill rejects with an actionable whitelist hint", () => {
    const recs = synthesizeHeuristicInsights({
      publishing: { publishes: 6, failures: 0, composio_failed: 0, composio_ok: 20 },
      validator: { rejects: 2, top_reasons: [{ reason: "spill:xyz", count: 2 }] },
      engagement: { post_count: 1, total_views: 10, total_likes: 1 },
    });
    assert.ok(recs.some((r) => /whitelist/i.test(r)), "spill reject must produce whitelist recommendation");
  });

  it("cold database (no rows) never throws and says so", () => {
    const summary = generateAuditSummary([], [], "7d");
    assert.equal(summary.publishing.publishes, 0);
    assert.equal(summary.engagement.post_count, 0);
    assert.ok(summary.recommendations.some((r) => /belum ada/i.test(r)));
  });
});
