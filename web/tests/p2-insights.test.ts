import { test } from "node:test";
import assert from "node:assert/strict";
import { bestHours, suggestSlotTimes } from "../../src/core/insights.ts";
import { aggregatePerf, bestOpenFor, MIN_SAMPLE } from "../../src/core/hook-perf.ts";

// created_at is UTC stamp; WIB = +7. 12:00 UTC -> 19 WIB.
const row = (utcHour: string, reach: number) => ({
  created_at: `2026-10-01 ${utcHour}:00:00`,
  metrics: JSON.stringify({ reach }),
});

test("bestHours ranks by reach, converts to WIB, respects min posts", () => {
  const rows = [
    ...Array.from({ length: 3 }, () => row("12:00", 100)), // 19 WIB, avg 100
    ...Array.from({ length: 3 }, () => row("00:00", 10)), // 07 WIB, avg 10
    row("05:00", 999), // 12 WIB — single lucky post, must be excluded (< MIN_SAMPLE)
  ];
  const top = bestHours(rows, 30, 3);
  assert.equal(top[0]?.hourLocal, "19");
  assert.equal(top[0]?.posts, 3);
  assert.ok(!top.some((t) => t.hourLocal === "12"), "thin sample hour excluded");
  assert.deepEqual(suggestSlotTimes(top), ["19:30", "07:30"]);
});

test("aggregatePerf buckets reach+engagement per hook open", () => {
  const rows = [
    { b: "HELM A\nsisa", m: '{"reach":10,"likes":1}', p: "Helm KYT", k: null },
    { b: "HELM A\nsisa", m: '{"reach":20,"comments":2}', p: "Helm GM", k: null },
    { b: "HELM B", m: '{"reach":5}', p: "Helm X", k: null },
  ];
  const perf = aggregatePerf(rows);
  assert.equal(perf.helm["HELM A"].posts, 2);
  assert.equal(perf.helm["HELM A"].score, 10 + 2 * 1 + 20 + 2 * 2); // 32
  assert.equal(perf.helm["HELM B"].score, 5);
});

test("bestOpenFor needs MIN_SAMPLE and picks smoothed winner", () => {
  const perf = { helm: { A: { posts: MIN_SAMPLE, score: 300 }, B: { posts: MIN_SAMPLE, score: 30 } } };
  assert.equal(bestOpenFor(JSON.stringify(perf), "helm"), "A");
  // below sample => no winner, rotation stays
  const thin = { helm: { A: { posts: MIN_SAMPLE - 1, score: 300 }, B: { posts: 1, score: 5 } } };
  assert.equal(bestOpenFor(JSON.stringify(thin), "helm"), null);
  assert.equal(bestOpenFor(null, "helm"), null);
  assert.equal(bestOpenFor("not-json", "helm"), null);
  assert.equal(bestOpenFor(JSON.stringify(perf), "gadget"), null);
});
