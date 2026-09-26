/** biolink self-check — reads the live sheet, never writes. */
import { strict as assert } from "node:assert";
import { fetchBioItems, nextIds, isOnBio, toRow, bioRowKey, ITEM_COLUMNS } from "../src/core/biolink.ts";

// B1: live read returns the same 7-column shape the sheet defines.
// The row count is not asserted against a constant: the sheet grows as links
// are published, and a stale literal would fail on a legitimate append.
const items = await fetchBioItems();
assert.ok(Array.isArray(items) && items.length > 0, "bio endpoint returned no items");
for (const i of items) {
  assert.ok(typeof i.title === "string" && i.title.length > 0, `row ${i.id}: empty title`);
  assert.ok(Array.isArray(i.images), `row ${i.id}: images must be an array`);
  assert.ok(typeof i.link === "string", `row ${i.id}: link must be a string`);
}

// B2: ids are unique and the next id is exactly max+1.
const ids = items.map((i) => Number(i.id));
assert.equal(new Set(ids).size, ids.length, "duplicate ids present");
const next = nextIds(items);
assert.equal(next.id, Math.max(...ids) + 1, "next id must be max+1");
assert.equal(next.nomor_urut, next.id, "nomor_urut must track id");

// B3: isOnBio matches an existing link and rejects an unknown one.
// isOnBio takes (items, rowKey, link); the row key is the sheet-identity of a
// row (link|title), so pass a key that cannot collide plus the link itself.
assert.equal(isOnBio(items, "__no_such_row__", "https://s.shopee.co.id/7fWhVsLimR"), true, "existing link not found");
assert.equal(isOnBio(items, "__no_such_row__", "https://s.shopee.co.id/7fWhVsLimR/"), true, "trailing slash must be ignored");
assert.equal(isOnBio(items, "__no_such_row__", "https://s.shopee.co.id/DOESNOTEXIST"), false, "unknown link must not match");
// The real row key for an existing row must also hit.
const firstRowKey = bioRowKey(items[0]);
assert.equal(isOnBio(items, firstRowKey, ""), true, "row key of an existing row must match");

// B4: toRow emits exactly the sheet's 7 columns in order.
const row = toRow({ title: "T", deskripsi: "D", link: "https://s.shopee.co.id/X", kategori: "Fasion", images: ["https://a/b.png", "https://c/d.png"] }, 99, 99);
assert.equal(row.length, ITEM_COLUMNS.length, "row width mismatch");
assert.equal(row[0], "99");
assert.equal(row[2], "T");
assert.equal(row[4], "https://s.shopee.co.id/X");
assert.equal(row[6], "https://a/b.png", "only the first image is pushed");

console.log("biolink self-check: 4/4 PASS");
console.log(`live items: ${items.length}, next id: ${next.id}`);
for (const i of items.slice(0, 10)) {
  console.log(`  ${String(i.id).padStart(2)} ${String(i.kategori).padEnd(11)} ${i.title.slice(0, 40)}`);
}
