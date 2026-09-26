import { getLink, updateLinkImage } from "../src/core/store.ts";
import { recreateProductImage } from "../src/core/recreate-image.ts";

const id = Number(process.argv[2] || 4);
const link = getLink(id);
if (!link) { console.log("no link", id); process.exit(1); }
console.log("BEFORE:", link.id, link.product, "|", link.image_url);

const before = link.image_url;
const t0 = Date.now();
const out = await recreateProductImage(link, process.argv[3]);
console.log("RESULT:", JSON.stringify(out, null, 2));
console.log("secs:", ((Date.now()-t0)/1000).toFixed(1));

const after = getLink(id);
console.log("AFTER image_url:", after?.image_url);
console.log("DB changed:", after?.image_url !== before);
