import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveShopeeUrl } from "../src/core/shopee.ts";
import { parseLinkBlob } from "../src/core/add-link.ts";

test("resolveShopeeUrl returns canonical product URL and item id", async () => {
  const res = await resolveShopeeUrl("https://s.shopee.co.id/5fp1UF7Q7o");
  assert.ok(res.ok, `resolve failed: ${res.reason}`);
  assert.ok(res.resolved_url?.startsWith("https://shopee.co.id/"), `unexpected target: ${res.resolved_url}`);
  assert.equal(res.shopee_item_id, "28620395139", "item id mismatch");
  assert.equal(res.shopee_shop_id, "1337935037", "shop id mismatch");
});

test("resolveShopeeUrl rejects non-Shopee / malformed url", async () => {
  const res = await resolveShopeeUrl("https://example.com/foo");
  assert.equal(res.ok, false);
  assert.equal(res.shopee_item_id, null);
});

test("parseLinkBlob accepts newline or comma separated links", () => {
  const inputs = parseLinkBlob("https://a.co\nhttps://b.co\nhttps://c.co\n");
  assert.equal(inputs.length, 3);
  assert.deepEqual(inputs.map((i) => i.short_url), [
    "https://a.co",
    "https://b.co",
    "https://c.co",
  ]);
});
