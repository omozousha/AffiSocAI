import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_WEIGHTS,
  tuneEngagementWeights,
  calculateEngagementScore,
  type EngagementWeights,
} from "../src/core/engagement-engine.ts";

describe("Lingkup 4 — Score Self-Tuning (Pagar ±20% & Rollback)", () => {
  it("uses default weights when none configured", () => {
    const s = calculateEngagementScore({ views: 100, likes: 10, comments: 2, shares: 1 });
    // 100*1 + 10*3 + 2*5 + 1*7 = 100 + 30 + 10 + 7 = 147
    assert.equal(s, 147);
  });

  it("calculates score with custom weights", () => {
    const custom: EngagementWeights = { views: 1, likes: 4, comments: 6, shares: 8 };
    const s = calculateEngagementScore({ views: 100, likes: 10, comments: 2, shares: 1 }, custom);
    // 100*1 + 10*4 + 2*6 + 1*8 = 100 + 40 + 12 + 8 = 160
    assert.equal(s, 160);
  });

  it("clamps weight shifts to maximum ±20% per tuning iteration", () => {
    const current: EngagementWeights = { views: 1.0, likes: 3.0, comments: 5.0, shares: 7.0 };
    // Suggest large shift: +50% likes, -50% comments
    const tuned = tuneEngagementWeights(current, {
      views: 1.5,
      likes: 6.0,    // +100% requested -> must clamp to max +20% (3.6)
      comments: 1.0, // -80% requested -> must clamp to min -20% (4.0)
      shares: 7.0,
    }, { drawdownPeriods: 0 });

    assert.ok(Math.abs(tuned.weights.likes - 3.6) < 0.001, `likes must be clamped to 3.6, got ${tuned.weights.likes}`);
    assert.ok(Math.abs(tuned.weights.comments - 4.0) < 0.001, `comments must be clamped to 4.0, got ${tuned.weights.comments}`);
    assert.equal(tuned.rollback, false);
  });

  it("auto-rolls back to default weights on 2 consecutive drawdown periods", () => {
    const shifted: EngagementWeights = { views: 1.2, likes: 3.6, comments: 6.0, shares: 8.4 };
    const tuned = tuneEngagementWeights(shifted, shifted, { drawdownPeriods: 2 });

    assert.deepEqual(tuned.weights, DEFAULT_WEIGHTS);
    assert.equal(tuned.rollback, true);
    assert.match(tuned.reason, /drawdown 2 periode/i);
  });
});
