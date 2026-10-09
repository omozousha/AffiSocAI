import { test } from "node:test";
import assert from "node:assert/strict";
import { buildIdentity } from "../src/core/product-identity.ts";
import { imagePromptFor } from "../src/core/product-hook.ts";

const id = (product: string, kategori = "") => buildIdentity({ product, kategori, shop: null });
const prompt = (p: string, k?: string) => imagePromptFor(id(p, k ?? ""));

/** Fixtures taken from live DB links that got a wrong or generic image prompt
 *  (proven: link 44 coffee maker was styled "cozy modern bedroom", vision-
 *  review rejected it). */
const CASES: Array<{ name: string; product: string; kategori: string; must: string[]; mustNot?: string[] }> = [
  // kitchen — was styled bedroom, the exact live failure
  { name: "coffee maker", product: "AZKO Kris Coffee Maker - Hitam Coffee Maker B", kategori: "Peralatan Dapur", must: ["coffee maker"], mustNot: ["bedroom"] },
  { name: "grinder", product: "ZHYO Grinder Kopi Elektrik Portable 30 Tingka", kategori: "Peralatan Dapur", must: ["grinder"], mustNot: ["bedroom"] },
  { name: "blender", product: "Blender Portable 500ml", kategori: "Peralatan Rumah Tangga", must: ["blender"], mustNot: ["bedroom"] },
  { name: "rice cooker", product: "Rice Cooker 1.8L Digital", kategori: "Peralatan Rumah Tangga", must: ["rice cooker"], mustNot: ["bedroom"] },
  { name: "sink filter", product: "Penyaring Air Keran Kitchen Sink Filter Kaca", kategori: "Peralatan Dapur", must: ["water filter"], mustNot: ["bedroom"] },
  // food — never was prompted at all (fell through to rumah/bedroom)
  { name: "popcorn", product: "Rituals Food Salted Caramel Popcorn 500gr", kategori: "Makanan", must: ["food"], mustNot: ["bedroom", "studio backdrop"] },
  { name: "dry rub", product: "Sprices BBQ Dry Rub Bumbu Marinasi Serba Guna", kategori: "Bumbu", must: ["food"], mustNot: ["bedroom"] },
  { name: "choco", product: "BELI 1 GRATIS 1 Coklat Dubai Chewy Chooki", kategori: "Makanan", must: ["food"], mustNot: ["bedroom"] },
  // drinkware — fell to generic "lain"
  { name: "tumbler", product: "Cuculemon Tumbler Stainless Steel 1L Kapasitas", kategori: "Minuman", must: ["tumbler"], mustNot: ["bedroom"] },
  // furniture / home goods — lifestyle interior is correct here
  { name: "shoe rack", product: "Rak Sepatu Duduk Sofa / Rak Sepatu", kategori: "Perabot", must: ["shoe rack", "entryway"], mustNot: ["bedroom"] },
  { name: "pillow", product: "Bantal Tidur Bantal Guling Hotel Premium Anti", kategori: "Perlengkapan Tidur", must: ["pillow"], mustNot: [] },
  // decor / aroma
  { name: "diffuser", product: "RK Kayu Pengharum Ruangan Aromaterapi Minyak", kategori: "Dekorasi", must: ["diffuser"], mustNot: ["bedroom"] },
  // automotive
  { name: "tire pump", product: "Pompa Ban motor dan mobil electric portable", kategori: "Otomotif", must: ["tire pump"], mustNot: ["bedroom"] },
  // gaming
  { name: "console", product: "Retro handheld R36S Classic Games", kategori: "Gaming", must: ["handheld game console"], mustNot: ["bedroom"] },
  // accessibility — "kursi" substring must not fall through to folding-chair/outdoor
  { name: "wheelchair", product: "COD Kursi Roda Putar 360 Kursi Mini Empuk", kategori: "Kesehatan", must: ["wheelchair"], mustNot: ["outdoor", "rock"] },
  // home hardware
  { name: "door stopper", product: "Nubri COD Penahan Pintu Anti Bentur Pelindung", kategori: "Perabot", must: ["door stopper"], mustNot: ["bedroom"] },
];

for (const c of CASES) {
  test(`img2img scene: ${c.name}`, () => {
    const p = prompt(c.product, c.kategori);
    for (const m of c.must) assert.ok(p.toLowerCase().includes(m.toLowerCase()), `${c.name}: prompt missing "${m}" — got: ${p.slice(0, 140)}`);
    for (const m of c.mustNot ?? []) assert.ok(!p.toLowerCase().includes(m.toLowerCase()), `${c.name}: prompt must not mention "${m}" — got: ${p.slice(0, 140)}`);
  });
}

test("img2img: every scene prompt keeps the fidelity clause", () => {
  for (const c of CASES) {
    const p = prompt(c.product, c.kategori);
    assert.match(p, /keep the product exactly as in the reference/i, c.name);
  }
});

test("img2img: existing correct types are untouched", () => {
  assert.match(prompt("Helm Full Face KYT Racing", "Helm"), /motorcycle helmet/);
  assert.match(prompt("Sepatu Sneakers Pria Running", "Sepatu"), /footwear/);
  assert.match(prompt("Skincare Serum Vitamin C 30ml", "Skincare"), /skincare product/);
});
