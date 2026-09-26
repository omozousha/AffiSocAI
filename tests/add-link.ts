import { addLinksBulk, parseLinkBlob, normaliseLink } from "../src/core/add-link.ts";

// unit: normalise rejects non-shopee
for (const bad of ["", "hello", "https://google.com", "ftp://x", "https://s.shopee.co.id/short"]) {
  console.log("reject?", JSON.stringify(bad), "->", JSON.stringify(normaliseLink(bad)));
}

// unit: blob parse
console.log("blob:", JSON.stringify(parseLinkBlob("https://s.shopee.co.id/7fWhVsLimR\n\nhttps://s.shopee.co.id/5q53LiBBuz, https://s.shopee.co.id/9026oNcoRs")));

// dry-run: og auto-fetch on 2 real links (no store, no sheet write)
const dry = await addLinksBulk(parseLinkBlob("https://s.shopee.co.id/7fWhVsLimR\nhttps://s.shopee.co.id/5q53LiBBuz"), { dryRun: true });
for (const r of dry.results) {
  console.log(`  ${r.short_url} -> status=${r.status} og=${r.og_found} img_ok=${r.image_verified} prod=${String(r.product).slice(0,40)}`);
}
