import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  calculateEngagementScore,
  aggregateHookStats,
  rankHooksEpsilonGreedy,
  getTopHooksForPrompt,
  type MetricRow,
} from "../src/core/engagement-engine.ts";

describe("Engagement Engine — Bayesian Scoring & Epsilon-Greedy", () => {
  it("calculates weighted engagement score correctly", () => {
    // ES = views + 3*(likes+saves) + 5*(comments) + 7*(shares)
    const metrics = {
      views: 100,
      likes: 10,
      saved: 5,
      comments: 4,
      shares: 2,
    };
    // 100 + 3*(10+5) + 5*(4) + 7*(2) = 100 + 45 + 20 + 14 = 179
    const score = calculateEngagementScore(metrics);
    assert.equal(score, 179);
  });

  it("handles alternative key names like reach, replies, reposts", () => {
    const metrics = {
      reach: 200,
      likes: 5,
      replies: 2,
      reposts: 1,
    };
    // 200 + 3*(5+0) + 5*(2) + 7*(1) = 200 + 15 + 10 + 7 = 232
    const score = calculateEngagementScore(metrics);
    assert.equal(score, 232);
  });

  it("aggregates metric rows per hook open-line", () => {
    const rows: MetricRow[] = [
      {
        body: "Mau outfit simpel tapi kelihatan mahal?\nPenjelasan...",
        metrics_json: JSON.stringify({ views: 100, likes: 10 }),
        product: "Kemeja Pria",
        kategori: "Fashion",
      },
      {
        body: "Mau outfit simpel tapi kelihatan mahal?\nBagian 2...",
        metrics_json: JSON.stringify({ views: 200, likes: 20 }),
        product: "Kemeja Linen",
        kategori: "Fashion",
      },
      {
        body: "Jangan beli baju ini sebelum tahu ini!\nTips...",
        metrics_json: JSON.stringify({ views: 50, likes: 2 }),
        product: "Celana",
        kategori: "Fashion",
      },
    ];

    const stats = aggregateHookStats(rows);
    assert.ok(stats["Mau outfit simpel tapi kelihatan mahal?"]);
    assert.equal(stats["Mau outfit simpel tapi kelihatan mahal?"].posts, 2);
    // Row 1: 100 + 3*10 = 130
    // Row 2: 200 + 3*20 = 260
    // Total raw: 390
    assert.equal(stats["Mau outfit simpel tapi kelihatan mahal?"].raw_score, 390);
  });

  it("ranks hooks using Bayesian smoothing", () => {
    const rows: MetricRow[] = [
      // Hook A: 4 posts, high score
      { body: "Hook A\n1", metrics_json: JSON.stringify({ views: 500, likes: 50 }), product: "P1", kategori: null },
      { body: "Hook A\n2", metrics_json: JSON.stringify({ views: 400, likes: 40 }), product: "P1", kategori: null },
      { body: "Hook A\n3", metrics_json: JSON.stringify({ views: 600, likes: 60 }), product: "P1", kategori: null },
      { body: "Hook A\n4", metrics_json: JSON.stringify({ views: 500, likes: 50 }), product: "P1", kategori: null },
      // Hook B: 1 post with high reach but zero engagement — the noise case
      // Bayesian smoothing must not let a single untested hook win.
      { body: "Hook B\n1", metrics_json: JSON.stringify({ views: 800, likes: 0 }), product: "P1", kategori: null },
      // Hook C: 3 posts low score
      { body: "Hook C\n1", metrics_json: JSON.stringify({ views: 50, likes: 1 }), product: "P1", kategori: null },
      { body: "Hook C\n2", metrics_json: JSON.stringify({ views: 40, likes: 2 }), product: "P1", kategori: null },
      { body: "Hook C\n3", metrics_json: JSON.stringify({ views: 60, likes: 0 }), product: "P1", kategori: null },
    ];

    const topHooks = getTopHooksForPrompt(rows, 3);
    assert.ok(topHooks.length >= 2);
    // Hook A should be at the top because it has high consistent posts
    assert.equal(topHooks[0].hook, "Hook A");
    assert.ok(topHooks[0].score > 0);
  });

  it("applies epsilon-greedy selection (deterministic test with mock random)", () => {
    const ranked = [
      { hook: "Best Hook", score: 95, posts: 10 },
      { hook: "Second Hook", score: 80, posts: 5 },
      { hook: "Third Hook", score: 60, posts: 4 },
      { hook: "Fourth Hook", score: 40, posts: 3 },
    ];

    // rand < 0.20 -> explore (picks randomly from non-top)
    const explored = rankHooksEpsilonGreedy(ranked, 0.20, () => 0.10, () => 0.0);
    assert.equal(explored, "Second Hook");

    // rand >= 0.20 -> exploit (picks top 1)
    const exploited = rankHooksEpsilonGreedy(ranked, 0.20, () => 0.50);
    assert.equal(exploited, "Best Hook");
  });

  it("handles cold start safely when no stats exist", () => {
    const selected = rankHooksEpsilonGreedy([], 0.20);
    assert.equal(selected, null);
    const top = getTopHooksForPrompt([], 3);
    assert.deepEqual(top, []);
  });
});
