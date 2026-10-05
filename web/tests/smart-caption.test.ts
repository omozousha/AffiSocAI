import { test } from "node:test";
import assert from "node:assert/strict";
import { validateStory, brandTokens, composeSmartBody } from "../../src/core/smart-caption.ts";

const GOOD = [
  "Ban kempis tengah jalan bikin runyam seketika. 🛞",
  "Tekanan angin pas itu kunci keselamatan dan hemat bensin — sedia pengisi tekanan darurat di bagasi.",
  "Tag teman yang sering lupa cek ban! Sharing kebiasaan kalian di komentar.",
].join("\n\n");

test("validateStory accepts a clean 3-paragraph story", () => {
  const s = validateStory(GOOD, "Pompa Ban Motor Electric Car Air Pump");
  assert.ok(s);
  assert.match(s!.hook, /ban kempis/i);
  assert.match(s!.cta, /tag teman/i);
});

test("validateStory rejects brand spill", () => {
  assert.equal(validateStory(GOOD + " KYT banget", "Helm KYT Race RP-V"), null);
  assert.equal(validateStory("Nubri ini mantap\n\nx\n\ny", "TWS Nubri ANC"), null);
});

test("validateStory rejects links, hashtags, unsourced claims", () => {
  assert.equal(validateStory("cek https://s.shopee.co.id/abc\n\n" + GOOD, null), null);
  assert.equal(validateStory("#ootd\n\n" + GOOD, null), null);
  assert.equal(validateStory("Gratis ongkir hari ini ya\n\n" + GOOD, null), null);
  assert.equal(validateStory("Harga 50rb saja\n\n" + GOOD, null), null);
  assert.equal(validateStory("sudah saya pakai seminggu\n\n" + GOOD, null), null);
});

test("validateStory rejects oversize and short output", () => {
  assert.equal(validateStory("a".repeat(200) + "\n\n" + "b".repeat(200) + "\n\n" + "c".repeat(200), null), null);
  assert.equal(validateStory("cuma satu paragraf", null), null);
});

test("brandTokens keeps model codes, drops category nouns", () => {
  const t = brandTokens("Helm KYT Race RP-V Full Face");
  assert.ok(t.includes("kyt"));
  assert.ok(t.some((x) => x.startsWith("rp"))); // RP / V parts with digit
  assert.ok(!t.includes("helm")); // first word = category noun, allowed
  assert.ok(!t.includes("full") && !t.includes("face"));
});

test("composeSmartBody: threads stays under budget, ig appends tag line", () => {
  const s = validateStory(GOOD, null)!;
  const th = composeSmartBody(s, "threads", "helm", ["motogp"]);
  const ig = composeSmartBody(s, "instagram", "helm", ["motogp"]);
  assert.ok(th.length <= 425, `threads ${th.length}`);
  assert.ok(th.includes("Link & detail lengkap ada di bio."));
  // ladder drops the tag line first when over budget; never the hook
  assert.ok(th.startsWith(s.hook));
  assert.match(ig, /#motogp/);
  assert.ok(ig.includes("Link & detail lengkap ada di bio."));
});
