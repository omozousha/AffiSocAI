// Lingkup 7 — type consistency guard: caption copy must match product type.
// Proven live: food links 8/11/25 published with generic "barang" copy
// (content 51-53, 72-74, 122-127).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { typeMismatch } from "../src/core/smart-caption.ts";

const FOOD_BODY =
  "Satu barang bikin berhenti scroll — bukan karena promo besar, tapi karena kelihatan benar-benar beda.\n\n" +
  "Garis desainnya clean, warnanya statement, langsung kebayang taruh di meja makan.\n\n" +
  "Link & detail lengkap ada di bio.";
const FOOD_OK =
  "Ngemil jam segini tuh godaan terbesar — yang bikin beda cuma pilihan camilannya. 🍿\n\n" +
  "Camilan yang renyah dan gurih bikin berhenti sebelum kebablasan.\n\n" +
  "Link & detail lengkap ada di bio.";

describe("Lingkup 7 — typeMismatch", () => {
  it("flags barang copy on food", () => {
    const r = typeMismatch("makanan", FOOD_BODY);
    assert.ok(r.includes("barang@food"), `expected barang@food, got ${r}`);
    assert.ok(r.includes("generic-copy@food"), `expected generic-copy@food, got ${r}`);
  });
  it("accepts food copy on food", () => {
    assert.deepEqual(typeMismatch("makanan", FOOD_OK), []);
  });
  it("flags generic copy on non-food, non-lain types", () => {
    const r = typeMismatch("helm", FOOD_BODY);
    assert.ok(r.includes("generic-copy@helm"), `got ${r}`);
  });
  it("flags food copy on non-food types", () => {
    const r = typeMismatch("helm", FOOD_OK);
    assert.ok(r.includes("food-copy@helm"), `got ${r}`);
  });
  it("lain is the catch-all — generic copy legal there", () => {
    assert.deepEqual(typeMismatch("lain", FOOD_BODY), []);
  });
  it("non-food copy passes on non-food types", () => {
    const helm =
      "Helm yang pengap itu bahaya — keringat netes ke mata pas lampu merah.\n\n" +
      "Ventilasi yang bener bikin kepala adem seharian.\n\n" +
      "Link & detail lengkap ada di bio.";
    assert.deepEqual(typeMismatch("helm", helm), []);
  });
});
