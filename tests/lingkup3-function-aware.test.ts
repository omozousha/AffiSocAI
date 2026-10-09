// Lingkup 3 — function-aware caption: detectType must classify by FUNCTION,
// not the subject noun; brandTokens must treat functional words as generic.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildIdentity, detectType } from "../src/core/product-identity.ts";
import { brandTokens, validateStory } from "../src/core/smart-caption.ts";

const id = (product: string, kategori: string) => buildIdentity({ product, kategori, shop: "s" });

describe("Lingkup 3 — detectType by function", () => {
  it("Shoes Dryer is an electrical tool, not fashion footwear", () => {
    assert.equal(detectType(id("Shoes Dryer Alat Pengering Sepatu Basah 10W Portable", "Fashion")), "gadget");
  });
  it("Rak Sepatu is furniture (rumah), not sepatu", () => {
    assert.equal(detectType(id("Rak Sepatu Duduk Sofa / Rak Sepatu 3 Tier", "Fashion")), "rumah");
  });
  it("Kipas Angin is gadget/rumah by function, not 'lain'", () => {
    assert.match(detectType(id("Momoda Kipas Angin Portable Tahan Lama", "Elektronik")), /gadget|rumah/);
  });
  it("Kamera Digital is gadget", () => {
    assert.match(detectType(id("Yincoree C2 Mini Kamera Digital Retro", "Fotografi")), /gadget/);
  });
  it("Coffee Grinder is rumah (appliance), not 'lain'", () => {
    assert.equal(detectType(id("ZHYO Grinder Kopi Elektrik Portable 30 Tingka", "Lainnya")), "rumah");
  });
  it("Pengering Pakaian is gadget", () => {
    assert.equal(detectType(id("Pengering Pakaian Portabel Tanpa Baterai", "Rumah Tangga")), "gadget");
  });
  it("real shoes still classify as sepatu", () => {
    assert.equal(detectType(id("Sepatu Running Pria Ringan", "Fashion")), "sepatu");
  });
  it("real helmet still classifies as helm", () => {
    assert.equal(detectType(id("Helm Half Face COSMO SN-60", "HELM")), "helm");
  });
});

describe("Lingkup 3 — functional words are not brand tokens", () => {
  const products = [
    "Shoes Dryer Alat Pengering Sepatu Basah 10W Portable",
    "Momoda Kipas Angin Portable Tahan Lama Kipas Mini",
    "Yincoree C2 Mini Kamera Digital Retro Thumb Camera",
    "ZHYO Grinder Kopi Elektrik Portable 30 Tingka",
    "AZKO Kris Coffee Maker - Hitam Coffee Maker",
  ];
  for (const p of products) {
    it(`no functional-word spill for: ${p.slice(0, 40)}`, () => {
      const toks = brandTokens(p);
      for (const w of ["pengering", "kering", "basah", "kipas", "angin", "tahan", "lama", "kamera", "grinder", "kopi", "coffee", "maker", "digital", "elektrik"]) {
        assert.ok(!toks.includes(w), `brandTokens must not include function word '${w}' — got ${JSON.stringify(toks)}`);
      }
    });
  }
  it("true brands still spill-blocked", () => {
    assert.ok(brandTokens("Helm KYT Neotech Murah").some((t) => t === "kyt" || t === "neotech"));
    // "lenovo" sits at word-0 (excluded by design — generic cap nouns live
    // there too: Helm/Pompa). The brand signal is "erazer" at index 1.
    assert.ok(brandTokens("Lenovo Erazer Mouse").includes("erazer"));
  });
  it("AI story about pengering sepatu passes validator now", () => {
    const text =
      "Sepatu basah tiap pagi bikin nggak nyaman.\n\nAlat pengering kecil dengan arus hangat menjaga sepatu tetap kering tanpa merusak lem.\n\nTag teman yang rajin nunggu sepatu kering semalaman.";
    const story = validateStory(text, "Shoes Dryer Alat Pengering Sepatu Basah 10W Portable");
    assert.ok(story, "validator must accept function words in caption");
    assert.match(story!.hook, /basah/);
  });
});
