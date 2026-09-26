/** shopee metadata + product name self-check — hits the real Shopee URL. */
import { strict as assert } from "node:assert";
import { fetchOg, checkImageUrl } from "../src/core/shopee.ts";
import { productName } from "../src/core/templates.ts";

const SHORT = "https://s.shopee.co.id/5fp1UF7Q7o";

// S1: real og fetch against the live link
const og = await fetchOg(SHORT);
assert.ok(og.image, "og:image must be resolvable from the live link");
assert.match(og.image!, /^https?:\/\//, "og:image must be an absolute url");
assert.ok(og.title, "og:title must be resolvable from the live link");
console.log("og:title  =", og.title);
console.log("og:image  =", og.image);
console.log("product   =", productName(og.title));

// S2: the image must actually be served as an image, not an HTML redirect
const img = await checkImageUrl(og.image!);
console.log("image     =", JSON.stringify(img));
assert.equal(img.ok, true, `image must be fetchable as an image: ${img.reason}`);
assert.match(img.contentType!, /^image\//i, "content-type must be image/*");
assert.ok(img.bytes! > 5000, `image too small to be a real product photo: ${img.bytes} bytes`);

// S3: productName must strip the sales prefix and the SEO tail
assert.equal(
  productName("Jual Helm Half Face COSMO | Black Dof Kaca Hitam | Paket Ganteng... "),
  "Helm Half Face COSMO",
);
assert.equal(productName("Jual Kaos Polos Premium Katun Combed 30s Hitam L"), "Kaos Polos Premium Katun Combed 30s Hitam L");
assert.equal(productName(null), null);
assert.equal(productName(""), null);
assert.equal(productName("ab"), null);
// A title with no separator that runs long is not a trustworthy name.
assert.equal(productName("Jual " + "x".repeat(100)), null);
// Trailing punctuation trimmed, "Jual" verb dropped.
assert.equal(productName("Jual Tas Ransel Anti Air."), "Tas Ransel Anti Air");

// S4: a non-image url is rejected, not passed through
const bad = await checkImageUrl("https://example.com/");
assert.equal(bad.ok, false, "an html page must not pass as an image");
assert.equal(bad.status, 200);

console.log("shopee self-check: 4/4 PASS");
