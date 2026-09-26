/**
 * biolink write lifecycle check — REQUIRES EXPLICIT OPT-IN.
 *
 * This appends a real row to the live `items` tab, verifies it round-trips
 * through the Apps Script the bio page reads, then deletes it again. Run with:
 *   node check-biolink-write.ts --confirm-i-own-this-sheet
 */
import { strict as assert } from "node:assert";
import {
  fetchBioItems,
  nextIds,
  toRow,
  ITEM_COLUMNS,
  appendBioItem,
  deleteBioRow,
} from "../src/core/biolink.ts";

if (!process.argv.includes("--confirm-i-own-this-sheet")) {
  console.error("refusing to write without --confirm-i-own-this-sheet");
  process.exit(2);
}

// W1: baseline read and id allocation.
const before = await fetchBioItems();
const { id, nomor_urut } = nextIds(before);
const expectRow = id + 1; // header row occupies row 1
console.log(`baseline: ${before.length} rows, next id ${id}, writes to sheet row ${expectRow}`);

// W2: append. The row is a probe, not a product — the link is obviously fake
// so a real affiliate link can never collide with it.
const probe = {
  title: "QUASAR write probe",
  deskripsi: "temporary row, deleted by check-biolink-write.ts",
  link: "https://s.shopee.co.id/QUASAR-PROBE-DELETE-ME",
  kategori: "Fasion",
  images: ["https://down-id.img.susercontent.com/file/id-11134207-822wl-mmt59ryxhlhgb3"],
};
const row = toRow(probe, id, nomor_urut);
assert.equal(row.length, ITEM_COLUMNS.length);
const { updatedRange } = await appendBioItem(row, expectRow);
console.log(`appended at ${updatedRange}`);
assert.ok(new RegExp(String(expectRow)).test(updatedRange ?? ""), "row did not land where expected");

// W3: read back through the same endpoint the bio page uses. This is the
// meaningful check — the sheet write is only useful if the SPA sees it.
const afterAppend = await fetchBioItems();
const found = afterAppend.find((i) => (i.link || "") === probe.link);
assert.ok(found, "appended row not visible through the bio endpoint");
assert.equal(found.title, probe.title, "title did not round-trip");
assert.equal(found.kategori, probe.kategori, "kategori did not round-trip");
assert.equal(found.images[0], probe.images[0], "image did not round-trip");
assert.equal(afterAppend.length, before.length + 1, "row count changed by more than one");

// W4: delete by position and confirm the sheet is back to its baseline.
await deleteBioRow(expectRow);
const afterDelete = await fetchBioItems();
const gone = afterDelete.find((i) => (i.link || "") === probe.link);
assert.ok(!gone, "probe row still present after delete");
assert.equal(afterDelete.length, before.length, "delete did not restore the row count");

console.log(`biolink write lifecycle: 4/4 PASS — sheet restored to ${before.length} rows`);
