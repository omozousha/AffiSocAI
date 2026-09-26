/**
 * Diagnostic: does the Lumenfall generations endpoint actually condition on
 * the source image, or does it just do text-to-image and ignore it?
 *
 * Test 1 — SAME prompt, TWO different source images. If the two outputs are
 * near-identical, the `image` field is being ignored and every "recreation"
 * is really a fresh hallucination from the prompt text. That is the mechanism
 * behind "gambar tidak sesuai dengan produk".
 *
 * Test 2 — the standard OpenAI /images/edits (multipart) path, which passes
 * the source as a file part and conditions far more strongly.
 */
import { readFileSync, writeFileSync } from "node:fs";

const BASE = process.env.LUMENFALL_BASE_URL || "https://api.lumenfall.ai/openai/v1";
const KEY = process.env.LUMENFALL_API_KEY || "";
const MODEL = process.argv[2] || "gemini-2.5-flash-image";

if (!KEY) { console.error("LUMENFALL_API_KEY not set"); process.exit(1); }

const PROMPT = "Keep this exact product, unchanged: same shape, same brand text, same labels. "
  + "Replace only the background with a clean seamless white studio background, soft shadow. "
  + "Product photography, no watermark, no extra objects.";

const A = "/tmp/src-fan.jpg";   // kipas angin
const B = "/tmp/src-2.jpg";     // kursi lipat

async function generations(prompt: string, path?: string) {
  const body: Record<string, unknown> = { model: MODEL, prompt, n: 1, size: "1024x1024" };
  if (path) body.image = `data:image/jpeg;base64,${readFileSync(path).toString("base64")}`;
  const t0 = Date.now();
  const res = await fetch(`${BASE}/images/generations`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  const ms = Date.now() - t0;
  let d: any = null;
  try { d = JSON.parse(text); } catch { /* non-json */ }
  return { ok: res.ok, ms, status: res.status, text, d };
}

async function edits(path: string, prompt: string) {
  const fd = new FormData();
  const bytes = readFileSync(path);
  fd.append("image", new Blob([bytes], { type: "image/jpeg" }), "src.jpg");
  fd.append("model", MODEL);
  fd.append("prompt", prompt);
  fd.append("n", "1");
  const t0 = Date.now();
  const res = await fetch(`${BASE}/images/edits`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}` },   // no content-type: fetch sets the boundary
    body: fd,
  });
  const text = await res.text();
  const ms = Date.now() - t0;
  let d: any = null;
  try { d = JSON.parse(text); } catch { /* non-json */ }
  return { ok: res.ok, ms, status: res.status, text, d };
}

function report(tag: string, r: { ok: boolean; ms: number; status: number; text: string; d: any }) {
  const it = r.d?.data?.[0] ?? {};
  console.log(`${tag}: HTTP ${r.status} (${r.ms}ms) keys=${JSON.stringify(Object.keys(it))}`);
  if (!r.ok) console.log(`  err: ${r.text.slice(0, 220)}`);
  if (it.url) console.log(`  url: ${it.url}`);
  if (it.b64_json) console.log(`  b64: ${it.b64_json.length} chars`);
  return it;
}

async function save(it: any, out: string) {
  if (it?.url) {
    const r = await fetch(it.url);
    const b = Buffer.from(await r.arrayBuffer());
    writeFileSync(out, b);
    console.log(`  saved ${out} ${b.length}b magic=${b.slice(0, 4).toString("hex")}`);
  } else if (it?.b64_json) {
    const b = Buffer.from(it.b64_json, "base64");
    writeFileSync(out, b);
    console.log(`  saved ${out} ${b.length}b magic=${b.slice(0, 4).toString("hex")}`);
  }
}

async function main() {
  console.log(`model: ${MODEL}\n`);

  console.log("== TEST 1: same prompt, two different sources ==");
  const g1 = await generations(PROMPT, A); const i1 = report("  source A (kipas)", g1); await save(i1, "/tmp/diag-a.png");
  const g2 = await generations(PROMPT, B); const i2 = report("  source B (kursi)", g2); await save(i2, "/tmp/diag-b.png");

  console.log("\n== TEST 1b: prompt only, no image at all ==");
  const g3 = await generations(PROMPT); const i3 = report("  no source", g3); await save(i3, "/tmp/diag-c.png");

  console.log("\n== TEST 2: /images/edits (multipart) ==");
  const e1 = await edits(A, PROMPT); const j1 = report("  edits A (kipas)", e1); await save(j1, "/tmp/diag-edits-a.png");
  const e2 = await edits(B, PROMPT); const j2 = report("  edits B (kursi)", e2); await save(j2, "/tmp/diag-edits-b.png");
}

main();
