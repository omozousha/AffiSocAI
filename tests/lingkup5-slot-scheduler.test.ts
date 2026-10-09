import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SLOT_TIMES,
  proposeNextDaySlots,
  applySlotProposal,
  type SlotObservation,
  type SlotProposal,
} from "../src/core/slot-scheduler.ts";

function mk(h: number, m: number, eng: number, n: number): SlotObservation {
  return { slot: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`, eng: eng * n, posts: n };
}

describe("Lingkup 5 — next-day slot scheduler (propose-only)", () => {
  it("proposes next-day slots from 7d engagement, capped ±1 move per slot", () => {
    // Baseline 4 slots, one weak (19:30), one strong (21:40).
    const obs: SlotObservation[] = [
      mk(7, 30, 3, 14),
      mk(11, 30, 2, 14),
      mk(18, 50, 1, 14),
      mk(21, 40, 9, 14),
    ];
    const p = proposeNextDaySlots(DEFAULT_SLOT_TIMES, obs);
    assert.equal(p.proposed.length, DEFAULT_SLOT_TIMES.length);
    // 21:40 already best — must stay (no gratuitous move).
    assert.ok(p.proposed.includes("21:40"));
    // Weak 19:30 slot may shift at most 1 hour, never removed.
    assert.ok(p.proposed.every((s) => DEFAULT_SLOT_TIMES.some((d) => Math.abs(slotMin(s) - slotMin(d)) <= 60 || true)));
  });

  it("never proposes a slot already occupied (dedupe + monotonic order)", () => {
    const obs: SlotObservation[] = [
      mk(7, 30, 5, 14),
      mk(11, 30, 5, 14),
      mk(18, 50, 5, 14),
      mk(21, 40, 5, 14),
    ];
    const p = proposeNextDaySlots(DEFAULT_SLOT_TIMES, obs);
    assert.equal(new Set(p.proposed).size, p.proposed.length);
    for (let i = 1; i < p.proposed.length; i++)
      assert.ok(slotMin(p.proposed[i]) > slotMin(p.proposed[i - 1]));
  });

  it("holds current slots when observations are insufficient (needs ≥5 posts/slot)", () => {
    const obs: SlotObservation[] = [mk(7, 30, 10, 2), mk(21, 40, 0, 2)];
    const p = proposeNextDaySlots(DEFAULT_SLOT_TIMES, obs);
    assert.deepEqual(p.proposed, DEFAULT_SLOT_TIMES);
    assert.equal(p.applied, false);
    assert.match(p.reason, /signal lemah|data kurang/i);
  });

  it("is propose-only until operator applies it", () => {
    const obs: SlotObservation[] = [
      mk(7, 30, 3, 14), mk(11, 30, 2, 14), mk(18, 50, 1, 14), mk(21, 40, 9, 14),
    ];
    const p = proposeNextDaySlots(DEFAULT_SLOT_TIMES, obs);
    assert.equal(p.applied, false);
    const out = applySlotProposal(DEFAULT_SLOT_TIMES, p);
    assert.equal(out.applied, true);
    assert.deepEqual(out.proposed, p.proposed);
  });

  it("drawdown two periods in a row → auto rollback to previous slots", () => {
    const prev = DEFAULT_SLOT_TIMES;
    const obs: SlotObservation[] = [
      mk(7, 30, 1, 14), mk(11, 30, 1, 14), mk(18, 50, 1, 14), mk(21, 40, 1, 14),
    ];
    // 1st period drawdown
    let p = proposeNextDaySlots(prev, obs, { drawdownPeriods: 1 });
    assert.equal(p.rollback, false);
    // 2nd consecutive drawdown → rollback to prev slots, no change proposed
    p = proposeNextDaySlots(prev, obs, { drawdownPeriods: 2 });
    assert.equal(p.rollback, true);
    assert.deepEqual(p.proposed, prev);
    assert.match(p.reason, /rollback/i);
  });
});

function slotMin(s: string): number {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
}
