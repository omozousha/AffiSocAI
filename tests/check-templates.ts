/** templates self-check — pure function, no network, no db. */
import { strict as assert } from "node:assert";
import { buildTemplates } from "../src/core/templates.ts";

const LINK = {
  short_url: "https://s.shopee.co.id/5fp1UF7Q7o",
  resolved_url: "https://shopee.co.id/opaanlp/1337935037/28620395139",
  shop: "opaanlp",
  shopee_shop_id: "1337935037",
  shopee_item_id: "28620395139",
};

const drafts = buildTemplates(LINK);
assert.equal(drafts.length, 3, "default target list is instagram, facebook, x");

const ig = drafts.find((d) => d.platform === "instagram")!;
const fb = drafts.find((d) => d.platform === "facebook")!;
const x = drafts.find((d) => d.platform === "x")!;

// T1: link placement is bio-only. No affiliate URL may appear in any caption,
// and no draft carries a first-comment link (the IG toolkit has no create-comment).
for (const d of drafts) {
  assert.ok(!d.body.includes(LINK.short_url), `${d.platform} body must not carry the affiliate link`);
  assert.equal(d.firstComment, null, `${d.platform} firstComment must be null`);
  assert.equal(d.linkPlacement, "bio", `${d.platform} linkPlacement must be bio`);
  assert.ok(d.body.includes("di bio"), `${d.platform} body must point at the bio`);
}

// T2: char limits actually enforced
assert.ok(x.body.length <= 280, `x body ${x.body.length} exceeds 280`);
assert.ok(ig.body.length <= 2200, `ig body ${ig.body.length} exceeds 2200`);

// T3: platform media requirements
assert.equal(ig.needsMedia, true, "instagram cannot publish without media");
assert.equal(fb.needsMedia, true, "facebook photo post also needs media for this template");
assert.equal(x.needsMedia, false);

// T4: no fabricated product claims — the seller slug is the only real fact used.
const unknown = buildTemplates({ ...LINK, shop: null });
for (const d of unknown) {
  assert.ok(d.body.includes("toko ini"), `${d.platform}: missing shop must degrade to a generic label`);
  assert.ok(!d.body.includes("undefined"), `${d.platform}: undefined leaked into the caption`);
  assert.ok(/\bnull\b/.test(d.body) === false, `${d.platform}: null leaked into the caption`);
}

// T5: a custom platform subset is honoured
const only = buildTemplates(LINK, undefined, ["x"]);
assert.equal(only.length, 1);
assert.equal(only[0].platform, "x");

// T6: a caller-supplied url must still not leak into a caption (bio-only wins).
const override = buildTemplates(LINK, "https://example.com/override");
for (const d of override) {
  assert.ok(!d.body.includes("https://example.com/override"), `${d.platform}: overridden url leaked into caption`);
}

console.log("templates self-check: 6/6 PASS");
for (const d of drafts) {
  console.log(`\n--- ${d.platform} (${d.body.length} chars) ---`);
  console.log(d.body);
}
