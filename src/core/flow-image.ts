/**
 * Google Flow image generation via browser automation + cookies.
 *
 * Supports two modes:
 * - text-to-image: prompt only (Nano Banana 2)
 * - image-to-image: upload reference photo first, then prompt (preserves product identity)
 *
 * No API key. No OAuth. Operator logs in once, exports cookies, session lasts
 * ~180 days. Cookies stored 0600 at ~/.affiliate-tools/flow/flow-cookies.json.
 */

import { spawnSync } from "node:child_process";
import { writeFileSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { loadFlowCookies, flowStatus } from "./flow-auth.ts";

const AB_BIN = "/root/.npm/_npx/ad6c181e5b604bdb/node_modules/agent-browser/bin/agent-browser-linux-arm64";
const AB_CHROME = "/root/.cache/ms-playwright/chromium-1243/chrome-linux-arm64/chrome";
const FLOW_PROJECT = "https://flow.google.com/project/b21f6b6c-34c5-4ce8-af46-055de237b057";

const AB_ENV = { ...process.env, AGENT_BROWSER_EXECUTABLE_PATH: AB_CHROME };

function ab(...args: string[]): string {
  const r = spawnSync(AB_BIN, args, { env: AB_ENV, encoding: "utf8", timeout: 120_000 });
  return (r.stdout || "") + (r.stderr || "");
}

function abSilent(...args: string[]): string {
  const r = spawnSync(AB_BIN, args, { env: AB_ENV, encoding: "utf8", timeout: 60_000 });
  return r.stdout || "";
}

/** Inject all stored cookies into the running browser session. */
async function injectCookies(): Promise<boolean> {
  const cookies = loadFlowCookies();
  if (cookies.length === 0) return false;
  let ok = 0;
  for (const c of cookies) {
    const args = ["cookies", "set", c.name, c.value, "--domain", c.domain, "--path", c.path || "/"];
    if (c.httpOnly) args.push("--httpOnly");
    if (c.secure) args.push("--secure");
    const r = spawnSync(AB_BIN, args, { env: AB_ENV, encoding: "utf8", timeout: 15_000 });
    if (r.status === 0) ok++;
  }
  return ok > 0;
}

/** Extract signed CDN image URLs from the browser DOM. */
function extractImageUrls(): string[] {
  const out = abSilent("eval", "Array.from(document.images).map(i=>i.src).filter(s=>s.includes('flow-content.google')).join('|SPLIT|')");
  return out.replace(/^"|"$/g, "").split("|SPLIT|").map(s => s.trim()).filter(Boolean);
}

/** Download a signed Flow CDN URL → buffer. */
async function downloadFlowImage(url: string): Promise<Buffer | null> {
  try {
    const r = spawnSync("curl", ["-s", "-m", "60", url], { encoding: "buffer", timeout: 70_000 });
    if (r.status !== 0 || !r.stdout || r.stdout.length < 2000) return null;
    const b = r.stdout;
    if ((b[0] === 0xff && b[1] === 0xd8) || (b[0] === 0x89 && b[1] === 0x50)) return b;
    return null;
  } catch {
    return null;
  }
}

/** Navigate to the Flow project editor and ensure we're logged in. */
async function openEditor(): Promise<boolean> {
  ab("open", FLOW_PROJECT);
  await new Promise(r => setTimeout(r, 15_000));
  await injectCookies();
  ab("reload");
  await new Promise(r => setTimeout(r, 15_000));
  const snap = ab("snapshot");
  return snap.includes("contenteditable") || snap.includes("Apa yang ingin Anda buat") || snap.includes("Nano Banana");
}

/**
 * Upload a reference image into the Flow prompt box via the + attachment button.
 * Falls back silently if upload UI is not available.
 */
async function uploadReferenceImage(imgBytes: Uint8Array, mime: string): Promise<boolean> {
  const ext = mime === "image/png" ? "png" : "jpg";
  const tmpPath = join("/tmp", `flow-ref-${Date.now()}.${ext}`);
  try {
    writeFileSync(tmpPath, Buffer.from(imgBytes));
    ab("click", "button[aria-label*='Tambahkan bahan']");
    await new Promise(r => setTimeout(r, 2000));
    const upResult = ab("upload", "input[type='file']", tmpPath);
    if (upResult.includes("✓") || upResult.includes("Done")) {
      await new Promise(r => setTimeout(r, 5000));
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
 * When refImage is supplied, uploads it as reference first (image-to-image).
 * Falls back to text-to-image automatically if upload fails.
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
  ab("click", "[contenteditable='true']");
  await new Promise(r => setTimeout(r, 400));
  ab("press", "Control+a");
  ab("press", "Delete");
  await new Promise(r => setTimeout(r, 300));

  // Image-to-image: upload reference first
  let mode: "text-to-image" | "image-to-image" = "text-to-image";
  if (refImage) {
    const uploaded = await uploadReferenceImage(refImage.bytes, refImage.mime);
    if (uploaded) {
      mode = "image-to-image";
      console.log("[flow] reference image uploaded — image-to-image mode");
    } else {
      console.warn("[flow] reference upload failed — falling back to text-to-image");
    }
  }

  // Type prompt
  ab("fill", "[contenteditable='true']", prompt);
  await new Promise(r => setTimeout(r, 800));

  // Snapshot existing URLs so we detect only NEW ones
  const beforeUrls = extractImageUrls();

  // Submit
  const clickResult = ab("click", "button[aria-label*='Mulai']");
  if (!clickResult.includes("✓")) ab("press", "Enter");

  // Wait up to 150s for new images
  await new Promise(r => setTimeout(r, 5000));
  const deadline = Date.now() + 150_000;
  let newUrls: string[] = [];
  while (Date.now() < deadline) {
    const allUrls = extractImageUrls();
    newUrls = allUrls.filter(u => !beforeUrls.includes(u));
    if (newUrls.length >= 1) break;
    await new Promise(r => setTimeout(r, 4000));
  }

  if (newUrls.length === 0) newUrls = extractImageUrls();
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
