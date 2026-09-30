/**
 * Journey caption guard. The reference-post arc is captured in prose, but the
 * hard constraint is the Threads 500-char limit — the caption is a fixed
 * template with a handful of substituted counters, so the danger is not prose
 * drift but a counter growing to a width the template was never sized for
 * (e.g. products 13 → 130). This locks the headroom so a future number does
 * not silently break the publish.
 *
 * Run: node --test src/core/journey-card.test.ts
 */

import test from "node:test";
import assert from "node:assert/strict";
import { journeyCaption, journeyText, journeyHashtags } from "./journey-card.ts";

const HARD_LIMIT = 500; // Threads text limit enforced by ThreadsAdapter.validateContent
/** Leave room for a 4-digit product count and hashtags. */
const HEADROOM = 60;

const base = {
  products: 13,
  categories: 5,
  contentPieces: 21,
  postsPublished: 8,
  daysActive: 3,
  handle: "karasu_michi",
  period: "September 2026",
};

test("caption stays inside the Threads limit plus headroom", () => {
  assert.ok(
    journeyCaption(base).length <= HARD_LIMIT - HEADROOM,
    `caption too long: ${journeyCaption(base).length}`,
  );
});

test("caption survives four-digit counters", () => {
  const big = { ...base, products: 1384, categories: 42, postsPublished: 391 };
  assert.ok(journeyCaption(big).length <= HARD_LIMIT, `captions: ${journeyCaption(big).length}`);
});

test("caption carries the real numbers", () => {
  const text = journeyCaption(base);
  for (const n of [base.products, base.categories, base.postsPublished]) {
    assert.ok(text.includes(String(n)), `missing ${n}`);
  }
  assert.ok(text.includes(base.handle));
});

test("caption has no sales claim — the card is the only proof", () => {
  const text = journeyText(base).toLowerCase();
  for (const banned of ["rp", "omzet", "penjualan", "cuan", "untung"]) {
    assert.ok(!text.includes(banned), `sales claim leaked: ${banned}`);
  }
});

test("hashtags stay product-led", () => {
  const tags = journeyHashtags(base);
  assert.equal(tags.length, 5);
  assert.ok(tags.every((t) => t.startsWith("#")));
});
