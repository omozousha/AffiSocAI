/**
 * Google Flow image generation via browser automation + cookies.
 *
 * Supports two modes:
 * - text-to-image: prompt only (Nano Banana 2)
 * - image-to-image: upload reference photo first, then prompt (preserves product identity)
 *
 * No API key. No OAuth. Operator logs in once, exports cookies, session lasts
 * ~180 days. Cookies stored 0600 at ~/.affiliate-tools/flow/flow-cookies.json.
 *
 * IMPORTANT: every agent-browser call is ASYNC (execFile). The previous
 * spawnSync version froze the Node event loop for up to 120 s per call, which
 * is what hung the whole API (page refresh, job polling) while a Flow job ran.
 * FIDELITY GUARD: when a reference image was requested but the upload fails,
 * we REFUSE to degrade to text-to-image — a t2i "product photo" from a prompt
 * is exactly how wrong-product creatives were produced. The caller then falls
 * through to the router img2img path instead.
 */

import { execFile } from "node:child_process";
import { unlinkSync, existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { loadFlowCookies, flowStatus } from "./flow-auth.ts";

const execFileP = promisify(execFile);
const AB_BIN = "/root/.npm/_npx/ad6c181e5b604bdb/node_modules/agent-browser/bin/agent-browser-linux-arm64";
const AB_CHROME = "/root/.cache/ms-playwright/chromium-1243/chrome-linux-arm64/chrome";
const FLOW_PROJECT = "https://flow.google.com/project/b21f6b6c-34c5-4ce8-af46-055de237b057";

const AB_ENV = { ...process.env, AGENT_BROWSER_EXECUTABLE_PATH: AB_CHROME };

async function ab(...args: string[]): Promise<string> {
  try {
    const r = await execFileP(AB_BIN, args, { env: AB_ENV as any, timeout: 120_000, maxBuffer: 32 * 1024 * 1024 });
    return (r.stdout || "") + (r.stderr || "");
  } catch (e) {
    return `ERROR: ${String(e).slice(0, 200)}`;
  }
}

async function abSilent(...args: string[]): Promise<string> {
  try {
    const r = await execFileP(AB_BIN, args, { env: AB_ENV as any, timeout: 60_000, maxBuffer: 32 * 1024 * 1024 });
    return r.stdout || "";
  } catch {
    return "";
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Inject all stored cookies into the running browser session. */
async function injectCookies(): Promise<boolean> {
  const cookies = loadFlowCookies();
  if (cookies.length === 0) return false;
  let ok = 0;
  for (const c of cookies) {
    const args = ["cookies", "set", c.name, c.value, "--domain", c.domain, "--path", c.path || "/"];
    if (c.httpOnly) args.push("--httpOnly");
    if (c.secure) args.push("--secure");
    try {
      await execFileP(AB_BIN, args, { env: AB_ENV as any, timeout: 15_000 });
      ok++;
    } catch { /* one bad cookie must not abort the session */ }
  }
  return ok > 0;
}

/** Extract signed CDN image URLs from the browser DOM. */
async function extractImageUrls(): Promise<string[]> {
  const out = await abSilent("eval", "Array.from(document.images).map(i=>i.src).filter(s=>s.includes('flow-content.google')).join('|SPLIT|')");
  return out.replace(/^"|"$/g, "").split("|SPLIT|").map((s) => s.trim()).filter(Boolean);
}

/** Download a signed Flow CDN URL → buffer. */
async function downloadFlowImage(url: string): Promise<Buffer | null> {
  try {
    const r = await execFileP("curl", ["-s", "-m", "60", url], { timeout: 70_000, encoding: "buffer", maxBuffer: 64 * 1024 * 1024 } as any);
    const b: Buffer = r.stdout;
    if (!b || b.length < 2000) return null;
    if ((b[0] === 0xff && b[1] === 0xd8) || (b[0] === 0x89 && b[1] === 0x50)) return b;
    return null;
  } catch {
    return null;
  }
}

/** Navigate to the Flow project editor and ensure we're logged in. */
async function openEditor(): Promise<boolean> {
  await ab("open", FLOW_PROJECT);
  await sleep(15_000);
  await injectCookies();
  await ab("reload");
  await sleep(15_000);
  const snap = await ab("snapshot");
  return snap.includes("contenteditable") || snap.includes("Apa yang ingin Anda buat") || snap.includes("Nano Banana");
}

/**
 * Upload a reference image into the Flow prompt box via the + attachment button.
 */
async function uploadReferenceImage(imgBytes: Uint8Array, mime: string): Promise<boolean> {
  const ext = mime === "image/png" ? "png" : "jpg";
  const tmpPath = join("/tmp", `flow-ref-${Date.now()}.${ext}`);
  try {
    await writeFile(tmpPath, Buffer.from(imgBytes));
    await ab("click", "button[aria-label*='Tambahkan bahan']");
    await sleep(2000);
    const upResult = await ab("upload", "input[type='file']", tmpPath);
    if (upResult.includes("✓") || upResult.includes("Done")) {
      await sleep(5000);
      return true;
    }
    return false;
  } catch {
    return false;
  } finally {
    try { if (existsSync(tmpPath)) unlinkSync(tmpPath); } catch { /* ignore */ }
  }
}

export type FlowGenResult =
  | { ok: true; bytes: Uint8Array; mime: string; backend: "flow-nano-banana"; mode: "text-to-image" | "image-to-image" }
  | { ok: false; error: string };

/**
 * Generate one product image via Google Flow Nano Banana 2.
 *
 * When refImage is supplied the upload MUST succeed or the whole attempt
 * fails — degrading to text-to-image is how wrong-product creatives were
 * produced, so it is refused here.
 */
export async function flowGenerateImage(
  prompt: string,
  refImage?: { bytes: Uint8Array; mime: string },
): Promise<FlowGenResult> {
  const st = flowStatus();
  if (!st.live || (st.daysLeft ?? 0) <= 0) {
    return { ok: false, error: "flow: no active cookies — import via /api/flow/cookies" };
  }

  const editorOk = await openEditor();
  if (!editorOk) {
    return { ok: false, error: "flow: could not open project editor — session may have expired" };
  }

  // Clear prompt box
  await ab("click", "[contenteditable='true']");
  await sleep(400);
  await ab("press", "Control+a");
  await ab("press", "Delete");
  await sleep(300);

  // Image-to-image: upload reference first; refuse to degrade to t2i.
  let mode: "text-to-image" | "image-to-image" = "text-to-image";
  if (refImage) {
    const uploaded = await uploadReferenceImage(refImage.bytes, refImage.mime);
    if (!uploaded) {
      return { ok: false, error: "flow: reference upload failed — refusing text-to-image (product fidelity)" };
    }
    mode = "image-to-image";
    console.log("[flow] reference image uploaded — image-to-image mode");
  }

  // Type prompt
  await ab("fill", "[contenteditable='true']", prompt);
  await sleep(800);

  // Snapshot existing URLs so we detect only NEW ones
  const beforeUrls = await extractImageUrls();

  // Submit
  const clickResult = await ab("click", "button[aria-label*='Mulai']");
  if (!clickResult.includes("✓")) await ab("press", "Enter");

  // Wait up to 150s for new images
  await sleep(5000);
  const deadline = Date.now() + 150_000;
  let newUrls: string[] = [];
  while (Date.now() < deadline) {
    const allUrls = await extractImageUrls();
    newUrls = allUrls.filter((u) => !beforeUrls.includes(u));
    if (newUrls.length >= 1) break;
    await sleep(4000);
  }

  if (newUrls.length === 0) newUrls = await extractImageUrls();
  if (newUrls.length === 0) {
    return { ok: false, error: "flow: generation timed out — no images appeared" };
  }

  for (const url of newUrls) {
    const buf = await downloadFlowImage(url);
    if (buf) {
      const mime = buf[0] === 0x89 ? "image/png" : "image/jpeg";
      return { ok: true, bytes: new Uint8Array(buf), mime, backend: "flow-nano-banana", mode };
    }
  }

  return { ok: false, error: "flow: download failed for all generated URLs" };
}
