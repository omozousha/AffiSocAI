/**
 * store self-check — 6 assertions, throwaway db.
 * AFFILIATE_DB MUST be set before the store module is first imported.
 */
import { strict as assert } from "node:assert";
import { rmSync } from "node:fs";

const TEST_DB = "/root/AffiSocAI/data/test-store.db";
process.env.AFFILIATE_DB = TEST_DB;
rmSync(TEST_DB, { force: true });
rmSync(TEST_DB + "-wal", { force: true });
rmSync(TEST_DB + "-shm", { force: true });

const { addLink, addContent, listContent, listLinks, setContentStatus, parseShopee, deleteLink } = await import(
  "../src/core/store.ts"
);

// C1: shopee id parsing from a resolved url with query junk
assert.deepEqual(
  parseShopee("https://shopee.co.id/{{SHOP_SLUG}}/1337935037/28620395139?__mobile__=1&x=2"),
  { shopId: "1337935037", itemId: "28620395139", shop: "{{SHOP_SLUG}}" },
  "must pull shopId/itemId/shop out of the product path",
);

// C2: first insert captures the parsed ids
const a = addLink({
  short_url: "https://s.shopee.co.id/5fp1UF7Q7o",
  resolved_url: "https://shopee.co.id/{{SHOP_SLUG}}/1337935037/28620395139",
  note: "manual",
});
assert.equal(a.shop, "{{SHOP_SLUG}}");
assert.equal(a.shopee_shop_id, "1337935037");
assert.equal(a.shopee_item_id, "28620395139");

// C3: upsert on the unique short_url must reuse the row, not duplicate
const b = addLink({ short_url: "https://s.shopee.co.id/5fp1UF7Q7o", note: "manual2" });
assert.equal(b.id, a.id, "same short_url must reuse the row id");
assert.equal(listLinks().length, 1, "upsert must not create a second row");

// C4: content insert persists with draft default
const c = addContent({ link_id: a.id, platform: "instagram", body: "test" });
assert.equal(c.status, "draft");
assert.equal(listContent(a.id).length, 1);

// C5: status transition keeps post_id / post_url
setContentStatus(c.id, "published", { post_id: "1789", post_url: "https://instagram.com/p/1789" });
const c2 = listContent(a.id)[0];
assert.equal(c2.status, "published");
assert.equal(c2.post_id, "1789");
assert.equal(c2.post_url, "https://instagram.com/p/1789");

// C6: deleting a link must also delete its content rows
deleteLink(a.id);
assert.equal(listContent(a.id).length, 0, "deleting a link must clear its content");
assert.equal(listLinks().length, 0, "the link row itself must be gone");

rmSync(TEST_DB, { force: true });
rmSync(TEST_DB + "-wal", { force: true });
rmSync(TEST_DB + "-shm", { force: true });
console.log("store self-check: 6/6 PASS");
