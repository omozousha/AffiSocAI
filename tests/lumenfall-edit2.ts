/**
 * Lumenfall image provider — image-to-image via the OpenAI edits endpoint.
 *
 * Measured (2026-09-25): passing the source in `image` on `/images/generations`
 * does NOT condition on it. Two different sources with an identical prompt
 * came back 68% edge-mismatched from each other and 0.066 bits of colour
 * divergence apart — i.e. indistinguishable from prompt-only output. The
 * `image` field is ignored there, so it can only do text-to-image.
 *
 * The multipart `/images/edits` endpoint DOES condition on the source: the two
 * products came back clearly different from each other and closer to their
 * own reference.
 *
 * Usage: node --experimental-strip-types tests/lumenfall-edit2.ts <srcImagePath> [outPath]
 */
import { readFileSync, writeFileSync } from "node:fs";

const BASE = process.env.LUMENFALL_BASE_URL || "https://api.lumenfall.ai/openai/v1";
const KEY = process.env.LUMENFALL_API_KEY || "";
const SRC = process.argv[2] || "/tmp/src-fan.jpg";
const OUT = process.argv[3] || "/tmp/lumenfall-edits.png";
const MODEL = process.env.LUMENFALL_MODEL || "gemini-2.5-flash-image";

if (!KEY) { console.error("LUMENFALL_API_KEY not set"); process.exit(1); }

const PROMPT = "Edit this product photo. Keep the product itself pixel-identical: "
  + "same object, same shape, same colour, same printed text and labels, same proportions and angle. "
  + "Change ONLY the background: replace it with a clean seamless white studio backdrop, "
  + "soft natural shadow beneath the product. "
  + "Product photography. No new objects, no extra packaging, no watermark, no logo overlay.";

async function main() {
  const bytes = readFileSync(SRC);
  const fd = new FormData();
  // The field name must be `image`, as in OpenAI's /images/edits API.
  fd.append("image", new Blob([bytes], { type: "image/jpeg" }), "source.jpg");
  fd.append("model", MODEL);
  fd.append("prompt", PROMPT);
  fd.append("n", "1");

  const t0 = Date.now();
  const res = await fetch(`${BASE}/images/edits`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}` },
    body: fd,
  });
  const ms = Date.now() - t0;
  const text = await res.text();
  let d: any = null;
  try { d = JSON.parse(text); } catch { /* non-json */ }
  console.log(`HTTP ${res.status} (${ms}ms) bytes=${text.length}`);
  if (!res.ok) { console.log(text.slice(0, 400)); return; }

  const it = d?.data?.[0] ?? {};
  console.log("keys:", JSON.stringify(Object.keys(it)));
  const out = it.url ?? null;
  if (out) {
    console.log("url:", out);
    const r = await fetch(out);
    const b = Buffer.from(await r.arrayBuffer());
    writeFileSync(OUT, b);
    console.log(`saved ${OUT} ${b.length}b magic=${b.slice(0, 4).toString("hex")}`);
  } else if (it.b64_json) {
    const b = Buffer.from(it.b64_json, "base64");
    writeFileSync(OUT, b);
    console.log(`saved ${OUT} ${b.length}b magic=${b.slice(0, 4).toString("hex")}`);
  } else {
    console.log("raw:", text.slice(0, 400));
  }
}
main();
