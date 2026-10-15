// Lingkup 6 — makanan-aware: detectType must classify food as `makanan`
// (not `lain`/`rumah`), hooks/tags/clues must be food-flavoured, and the
// validator must not spill food nouns as "brand tokens".
// Proven live failures: link 8 (Dry Rub), 11 (Popcorn), 25 (Coklat Dubai)
// published with generic "barang" / "rumah" captions.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildIdentity, detectType, typeLabel } from "../src/core/product-identity.ts";
import { pickHook } from "../src/core/product-hook.ts";
import { buildMysteryCaption, categoryClue, tagsFor } from "../src/core/mystery-caption.ts";
import { brandTokens } from "../src/core/smart-caption.ts";
import { classifyCategory } from "../src/core/category.ts";

const id = (product: string, kategori = "") => buildIdentity({ product, kategori, shop: null });

describe("Lingkup 6 — detectType: food is makanan", () => {
  const food: Array<[string, string]> = [
    ["Sprices BBQ Dry Rub Bumbu Marinasi Serba Guna Rendah Kalori Diet", "Foods"],
    ["Rituals Food Salted Caramel Popcorn 500gr ukuran XXL - Homemade", "Foods"],
    ["( BELI 1 GRATIS 1) Coklat Dubai Chewy Chooki Pistachio Khunafa", "Lainnya"],
  ];
  for (const [p, k] of food) {
    it(`classifies food: ${p.slice(0, 40)}`, () => {
      assert.equal(detectType(id(p, k)), "makanan", `expected makanan, got ${detectType(id(p, k))}`);
    });
  }
  it("additional food signals classify as makanan", () => {
    assert.equal(detectType(id("Keripik Singkong Balado 200gr", "Lainnya")), "makanan");
    assert.equal(detectType(id("Mie Instan Goreng 85gr", "Lainnya")), "makanan");
    assert.equal(detectType(id("Teh Celup Melati 25 kantong", "Lainnya")), "makanan");
  });
  it("appliance containing 'coffee' stays an appliance (LINGKUP 3 preserved)", () => {
    assert.equal(detectType(id("AZKO Kris Coffee Maker - Hitam Coffee Maker", "Lainnya")), "rumah");
    assert.equal(detectType(id("ZHYO Grinder Kopi Elektrik Portable", "Lainnya")), "rumah");
    assert.equal(detectType(id("HydraGo Bottle 700ml Pembuat Kopi Cold Brew", "Rumah Tangga")), "rumah");
    assert.equal(detectType(id("UPUPIN Mesin Vacum Sealer Makanan Alat Vakum Makanan", "Elektronik")), "rumah");
  });
  it("non-food links unchanged", () => {
    assert.equal(detectType(id("Helm Half Face COSMO", "HELM")), "helm");
    assert.equal(detectType(id("Aerostreet Lizzie Sneakers Wanita", "Fasion")), "sepatu");
    assert.equal(detectType(id("Momoda Kipas Angin Portable", "Elektronik")), "gadget");
  });
  it("typeLabel(makanan) = camilan", () => {
    assert.equal(typeLabel("makanan"), "camilan");
  });
});

describe("Lingkup 6 — hooks, tags, clues are food-flavoured", () => {
  it("pickHook for a food link never returns the default 'barang' pool", () => {
    const h = pickHook(id("Rituals Food Salted Caramel Popcorn 500gr", "Foods"), 0);
    const barrels = /Tebak ini apa di komentar|Tips checkout online aman|ngebenerin masalah harian/i;
    assert.ok(!barrels.test(h.open + h.why + h.cta), `food post used generic barang hook: ${h.open}`);
    assert.match(h.open, /Ngemil|Camilan|bumbu/i, "food hook must be food-themed");
  });
  it("every makanan hook keeps the 3-paragraph shape", () => {
    for (let i = 0; i < 3; i++) {
      const h = pickHook(id("Coklat Dubai Pistachio Khunafa", "Foods"), i);
      assert.ok(h.open && h.why && h.cta, "hook variant incomplete");
      assert.match(h.cta, /bio/, "CTA must point to bio link");
      assert.ok(!/\{\{/.test(h.open + h.why + h.cta), "unfilled placeholder in hook");
    }
  });
  it("tagsFor(makanan) = food tags + #linkdiobio", () => {
    const t = tagsFor("makanan");
    assert.ok(t.some((x) => /camilan|makanan|snack|kuliner/.test(x)), `expected food tags, got ${t}`);
    assert.ok(t.includes("#linkdiobio"));
  });
  it("categoryClue maps food kategori labels to camilan, not barang", () => {
    for (const k of ["Foods", "Makanan", "Bumbu", "SNACK"]) {
      assert.equal(categoryClue(k), "camilan", `kategori ${k}`);
    }
    assert.equal(categoryClue("Elektronik"), "gadget");
  });
  it("mystery caption for a food link carries food tags and no barang hook", () => {
    const d = buildMysteryCaption("instagram", {
      short_url: "https://s.shopee.co.id/x", resolved_url: null,
      shopee_shop_id: null, shopee_item_id: null, shop: null,
      product: "Rituals Food Salted Caramel Popcorn 500gr", kategori: "Foods",
    }, 0);
    assert.ok((d.hashtags ?? []).some((x) => /camilan|makanan|snack/.test(x)), `tags: ${d.hashtags}`);
    assert.ok(!/Tebak ini apa|checkout online/.test(d.body), "body must not use generic barang copy");
  });
});

describe("Lingkup 6 — validator food nouns are not brand spill", () => {
  it("food title words are not brandTokens", () => {
    const toks = brandTokens("Rituals Food Salted Caramel Popcorn 500gr ukuran XXL");
    for (const w of ["food", "popcorn", "caramel", "salted", "homemade", "ukuran", "xxl"]) {
      assert.ok(!toks.includes(w), `brandTokens must not include '${w}' — got ${JSON.stringify(toks)}`);
    }
  });
  it("true brand in a food title still spills", () => {
    // word-0 title-case nouns are excluded by design ("Rituals" at 0 looks
    // like a category noun, same rule as "Helm"/"Pompa") — the brand signal
    // is any brand token at index > 0.
    assert.ok(brandTokens("Popcorn Rituals Caramel Crunch").includes("rituals"));
  });
});

describe("Lingkup 6 — classifyCategory returns Makanan", () => {
  it("keyword classifier maps food titles to Makanan", async () => {
    const r = await classifyCategory("Sprices BBQ Dry Rub Bumbu Marinasi", "");
    assert.equal(r.category, "Makanan");
    const r2 = await classifyCategory("Rituals Food Salted Caramel Popcorn 500gr", "");
    assert.equal(r2.category, "Makanan");
  });
  it("CATEGORIES includes Makanan (LLM label set)", async () => {
    const { CATEGORIES } = await import("../src/core/category.ts");
    assert.ok((CATEGORIES as readonly string[]).includes("Makanan"));
  });
});
