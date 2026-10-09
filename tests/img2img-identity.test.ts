import { test } from "node:test";
import assert from "node:assert/strict";
import { presetPrompt } from "../src/core/image-presets.ts";

// Identity guardrail: a product label must resolve to category-specific
// identity facts, not the generic fallback — the live helm proof showed the
// model swaps a plausible sibling unless defining features are named.
const generic = "exact design, colours, labels, printed text";

const cases: [string, string, string][] = [
  ["kabel USB type-c", "electronic", "port/connector"],
  ["kemeja flanel", "garment", "neckline"],
  ["serum wajah", "skincare", "pump vs dropper"],
  ["sepatu running", "footwear", "sole pattern"],
  ["tas punggung", "bag", "main compartment"],
  ["boneka teddy", "toy", "character shape"],
  ["dumbbell 5kg", "sports", "grip texture"],
  ["tenda 4p", "outdoor", "panel layout"],
  ["rak dinding", "home", "material look"],
];

test("identityFacts resolves category-specific facts, not generic fallback", () => {
  for (const [label, _cat, needle] of cases) {
    const p = presetPrompt("flatlay-studio", label, null);
    assert.ok(p.includes(needle), `${label} -> expected "${needle}" in prompt, got:\n${p}`);
    assert.ok(!p.startsWith(`Product: ${label}. ${generic}`), `${label} fell back to generic identity facts`);
  }
});

test("known helm identity facts still present (regression)", () => {
  const p = presetPrompt("flatlay-studio", "helm full face cosmos", null);
  assert.ok(p.includes("full-face motorcycle helmet"));
  assert.ok(p.includes("rear spoiler fin"));
});
