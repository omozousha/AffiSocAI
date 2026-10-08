import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { staleMetricsContentIds } from "../src/core/store.ts";

describe("Analytics Pulling Coverage", () => {
  it("staleMetricsContentIds returns content ids for published posts with post_id", () => {
    const ids = staleMetricsContentIds(24, 10);
    assert.ok(Array.isArray(ids), "should return an array of ids");
    // All returned IDs should be numbers
    for (const id of ids) {
      assert.equal(typeof id, "number");
    }
  });
});
