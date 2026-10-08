import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildMysteryCaption, bioLineFor } from "../src/core/mystery-caption.ts";
import { composeSmartBody } from "../src/core/smart-caption.ts";

describe("Caption Enrichment (Bio Number & Trending Tags)", () => {
  it("generates default bio line when sheet_id is absent or null", () => {
    assert.equal(bioLineFor(null), "Link & detail lengkap ada di bio.");
    assert.equal(bioLineFor(undefined), "Link & detail lengkap ada di bio.");
  });

  it("generates specific product number bio line when sheet_id is provided", () => {
    assert.equal(bioLineFor(12), "Cek produk No. 12 di link bio ya!");
    assert.equal(bioLineFor(1), "Cek produk No. 1 di link bio ya!");
  });

  it("buildMysteryCaption includes product number in IG and FB captions when sheet_id is given", () => {
    const link = {
      product: "Sepatu Sneakers Keren",
      kategori: "SEPATU",
      sheet_id: 10,
    };
    const igDraft = buildMysteryCaption("instagram", link as any, 0);
    assert.ok(igDraft.body.includes("Cek produk No. 10 di link bio ya!"));
    assert.equal(igDraft.bio_line, "Cek produk No. 10 di link bio ya!");

    const fbDraft = buildMysteryCaption("facebook", link as any, 0);
    assert.ok(fbDraft.body.includes("Cek produk No. 10 di link bio ya!"));
  });

  it("buildMysteryCaption appends trending tags to IG and FB without breaking limits", () => {
    const link = {
      product: "Tumbler Stainless",
      kategori: "RUMAH",
      sheet_id: 3,
    };
    const trends = ["#ViralHariIni", "#TrenTerkini"];
    const igDraft = buildMysteryCaption("instagram", link as any, 0, trends);
    assert.ok(igDraft.hashtags?.includes("#ViralHariIni"));
    assert.ok(igDraft.body.includes("#ViralHariIni"));
    assert.ok(igDraft.body.includes("#TrenTerkini"));
  });

  it("composeSmartBody includes product number and trend hashtags for IG and FB", () => {
    const story = {
      hook: "Kenapa tumbler ini dingin seharian?",
      why: "Ternyata insulasi double wall stainless 304.",
      cta: "Jangan tunggu kehabisan warna favorit.",
    };
    const body = composeSmartBody(story, "instagram", "rumah", 5, ["#TrenSekarang"]);
    assert.ok(body.includes("Cek produk No. 5 di link bio ya!"));
    assert.ok(body.includes("#TrenSekarang"));
  });
});
