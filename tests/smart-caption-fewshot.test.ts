import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatUserPrompt } from "../src/core/smart-caption.ts";

describe("Smart Caption Few-Shot Injection", () => {
  it("builds default user prompt without few-shot examples", () => {
    const prompt = formatUserPrompt(
      { product: "Kemeja Linen", kategori: "Fashion", shop: null },
      "Fashion Pria",
      [],
    );
    assert.ok(prompt.includes("Produk: Kemeja Linen"));
    assert.ok(!prompt.includes("Contoh hook pembuka"));
  });

  it("injects winning hooks into user prompt when available", () => {
    const hooks = [
      "Mau outfit simpel tapi kelihatan mahal?",
      "Rahasia tampil rapi tanpa gerah seharian.",
    ];
    const prompt = formatUserPrompt(
      { product: "Kemeja Linen", kategori: "Fashion", shop: null },
      "Fashion Pria",
      hooks,
    );
    assert.ok(prompt.includes("Contoh hook pembuka yang terbukti disukai audiens"));
    assert.ok(prompt.includes('- "Mau outfit simpel tapi kelihatan mahal?"'));
    assert.ok(prompt.includes('- "Rahasia tampil rapi tanpa gerah seharian."'));
  });
});
