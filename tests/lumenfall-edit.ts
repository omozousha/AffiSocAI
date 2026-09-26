/**
 * Probe the Lumenfall image provider: t2i and image-edit against a real product photo.
 * Usage: node --experimental-strip-types tests/lumenfall-edit.ts <model> <t2i|edit> [srcImagePath]
 */
import { readFileSync, writeFileSync } from "node:fs";

const [model, mode, srcPath] = [process.argv[2], process.argv[3], process.argv[4]];
const BASE = process.env.LUMENFALL_BASE_URL || "https://api.lumenfall.ai/openai/v1";
const KEY = process.env.LUMENFALL_API_KEY || "";

if (!KEY) { console.error("LUMENFALL_API_KEY not set"); process.exit(1); }

const prompt = "Keep this exact product, unchanged: same shape, same brand text, same labels. "
  + "Replace only the background with a clean seamless white studio background, soft shadow. "
  + "Product photography, no watermark, no extra objects.";

async function run() {
  const body: Record<string, unknown> = {
    model, prompt, n: 1, size: "1024x1024",
  };
  if (mode === "edit") {
    const b64 = readFileSync(srcPath || "/tmp/src-fan.jpg").toString("base64");
    body.image = `data:image/jpeg;base64,${b64}`;
  }
  const t0 = Date.now();
  const res = await fetch(`${BASE}/images/generations`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const ms = Date.now() - t0;
  const text = await res.text();
  let d: any;
  try { d = JSON.parse(text); } catch { console.log(`HTTP ${res.status} (non-json, ${ms}ms):`, text.slice(0, 200)); return; }
  if (!res.ok) { console.log(`HTTP ${res.status} (${ms}ms):`, JSON.stringify(d).slice(0, 300)); return; }
  const it = d?.data?.[0] ?? {};
  console.log(`HTTP 200 (${ms}ms) keys=${JSON.stringify(Object.keys(it))}`);
  if (it.b64_json) {
    const b = Buffer.from(it.b64_json, "base64");
    const out = `/tmp/lm-${mode}-${String(model).replace(/\W+/g, "_")}.bin`;
    writeFileSync(out, b);
    console.log("b64 saved:", out, b.length, "bytes magic", b.slice(0, 4).toString("hex"));
  } else if (it.url) {
    console.log("url:", it.url);
  } else {
    console.log("raw:", JSON.stringify(d).slice(0, 300));
  }
}
run();
