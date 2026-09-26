/**
 * Decisive colour-edit test.
 *
 * Fidelity numbers can lie (a global histogram shifts when only the background
 * changes). So ask a question with a measurable answer: "replace every RED
 * surface with a GREEN one". If the source image is genuinely conditioned on,
 * the dominant hue of the output must move red → green. If it does not, no
 * image-conditioning exists, whatever the prompt says.
 */
import { readFileSync, writeFileSync } from "node:fs";

const BASE = process.env.LUMENFALL_BASE_URL || "https://api.lumenfall.ai/openai/v1";
const KEY = process.env.LUMENFALL_API_KEY || "";
const SRC = process.argv[2] || "/tmp/src-fan.jpg";
const FROM = process.argv[3] || "red";
const TO = process.argv[4] || "green";
if (!KEY) { console.error("LUMENFALL_API_KEY not set"); process.exit(1); }

async function edit(prompt: string, endpoint: "generations" | "edits", useSource: boolean) {
  const t0 = Date.now();
  const res = await fetch(`${BASE}/images/${endpoint}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}` },
    body: (() => {
      const fd = new FormData();
      if (useSource) fd.append("image", new Blob([readFileSync(SRC)], { type: "image/jpeg" }), "src.jpg");
      fd.append("model", "gemini-2.5-flash-image");
      fd.append("prompt", prompt);
      fd.append("n", "1");
      return fd;
    })(),
  });
  const ms = Date.now() - t0;
  const text = await res.text();
  let d: any = null; try { d = JSON.parse(text); } catch { /* non-json */ }
  const it = d?.data?.[0] ?? {};
  return { ok: res.ok, status: res.status, ms, it, raw: text.slice(0, 300) };
}

async function save(it: any, out: string): Promise<string> {
  if (it?.url) {
    const r = await fetch(it.url);
    const b = Buffer.from(await r.arrayBuffer());
    writeFileSync(out, b);
    return out;
  }
  if (it?.b64_json) {
    writeFileSync(out, Buffer.from(it.b64_json, "base64"));
    return out;
  }
  throw new Error("no image in response");
}

async function main() {
  const PROMPT = `Recolor this ${FROM} object to ${TO}. Keep everything else — shape, size, material, background, framing — exactly the same. Only the colour changes.`;

  console.log("1) /images/edits WITH source, prompt:", JSON.stringify(PROMPT));
  const r1 = await edit(PROMPT, "edits", true);
  console.log(`   HTTP ${r1.status} (${r1.ms}ms) keys=${JSON.stringify(Object.keys(r1.it))}`);
  if (!r1.ok) return console.log("   ", r1.raw);
  const p1 = await save(r1.it, "/tmp/colour-edits.png");

  console.log("2) /images/edits WITHOUT source, same prompt");
  const r2 = await edit(PROMPT, "edits", false);
  console.log(`   HTTP ${r2.status} (${r2.ms}ms) keys=${JSON.stringify(Object.keys(r2.it))}`);
  let p2 = "";
  if (r2.ok) p2 = await save(r2.it, "/tmp/colour-nosrc.png");

  console.log("3) /images/generations WITH source in `image` field (JSON)");
  const fd = new FormData();
  fd.append("model", "gemini-2.5-flash-image");
  fd.append("prompt", PROMPT);
  fd.append("n", "1");
  const rg = await fetch(`${BASE}/images/generations`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gemini-2.5-flash-image",
      prompt: PROMPT,
      n: 1,
      image: `data:image/jpeg;base64,${readFileSync(SRC).toString("base64")}`,
    }),
  });
  const tg = await rg.text();
  let dg: any = null; try { dg = JSON.parse(tg); } catch { /* non-json */ }
  const ig = dg?.data?.[0] ?? {};
  console.log(`   HTTP ${rg.status} keys=${JSON.stringify(Object.keys(ig))}`);
  let p3 = "";
  if (rg.ok) p3 = await save(ig, "/tmp/colour-gen.png");

  console.log("\nsource            :", SRC);
  console.log("edits  + source   :", p1);
  if (p2) console.log("edits  - source   :", p2);
  if (p3) console.log("generate w/ image :", p3);
}
main();
