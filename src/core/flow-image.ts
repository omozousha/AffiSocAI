/**
 * Google Flow image generation via browser automation + cookies.
 *
 * Uses the operator's Flow session (imported via /api/flow/cookies) to drive
 * Chromium headlessly, submit a prompt in the project editor, wait for Nano
 * Banana 2 to generate, then download the signed CDN URLs via curl.
 *
 * No API key. No OAuth. Operator logs in once, exports cookies, session lasts
 * ~180 days. Cookies stored 0600 at ~/.affiliate-tools/flow/flow-cookies.json.
 */

import { execSync, spawnSync } from "node:child_process";
import { writeFileSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadFlowCookies, saveFlowCookies, parseCookieUpload } from "./flow-auth.ts";

const AB_BIN = "/root/.npm/_npx/ad6c181e5b604bdb/node_modules/agent-browser/bin/agent-browser-linux-arm64";
const AB_CHROME = "/root/.cache/ms-playwright/chromium-1243/chrome-linux-arm64/chrome";
const FLOW_PROJECT = "https://flow.google.com/project/b21f6b6c-34c5-4ce8-af46-055de237b057";
const FLOW_HOME = "https://labs.google/fx/tools/flow";

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
  const out = abSilent("eval", `Array.from(document.images).map(i=>i.src).filter(s=>s.includes('flow-content.google')).join('\\n')`);
  return out.replace(/^"|"$/g, "").split("\\n").map(s => s.trim()).filter(Boolean);
}

/** Download a signed Flow CDN URL → buffer. */
async function downloadFlowImage(url: string): Promise<Buffer | null> {
  try {
    const r = spawnSync("curl", ["-s", "-m", "60", url], { encoding: "buffer", timeout: 70_000 });
    if (r.status !== 0 || !r.stdout || r.stdout.length < 2000) return null;
    // Check JPEG/PNG magic bytes
    const b = r.stdout;
    if ((b[0] === 0xff && b[1] === 0xd8) || (b[0] === 0x89 && b[1] === 0x50)) return b;
    return null;
  } catch {
    return null;
  }
}

/** Wait up to maxMs for at least N flow-content image URLs to appear. */
async function waitForImages(n: number, maxMs: number): Promise<string[]> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const urls = extractImageUrls();
    if (urls.length >= n) return urls;
    await new Promise(r => setTimeout(r, 3000));
  }
  return extractImageUrls();
}

export type FlowGenResult =
  | { ok: true; bytes: Uint8Array; mime: string; backend: "flow-nano-banana" }
  | { ok: false; error: string };

/**
 * Generate one product image via Google Flow Nano Banana 2.
 * Returns the first successfully downloaded image.
 */
export async function flowGenerateImage(prompt: string): Promise<FlowGenResult> {
  const cookies = loadFlowCookies();
  if (cookies.length === 0) return { ok: false, error: "flow: no cookies — import via /api/flow/cookies" };

  // Navigate to the project editor
  ab("open", FLOW_PROJECT);
  await new Promise(r => setTimeout(r, 12_000));

  const injected = await injectCookies();
  if (!injected) return { ok: false, error: "flow: cookie injection failed" };

  // Reload so cookies take effect
  ab("reload");
  await new Promise(r => setTimeout(r, 15_000));

  // Check we landed in the editor (contenteditable present)
  const snap = ab("snapshot");
  if (!snap.includes("contenteditable") && !snap.includes("Apa yang ingin Anda buat")) {
    // Try navigating directly
    ab("open", FLOW_PROJECT);
    await new Promise(r => setTimeout(r, 15_000));
  }

  // Click + fill the prompt box
  ab("click", "[contenteditable='true']");
  await new Promise(r => setTimeout(r, 1000));
  ab("fill", "[contenteditable='true']", prompt);
  await new Promise(r => setTimeout(r, 1000));

  // Click generate button (arrow_forward / Mulai pembuatan)
  ab("click", "button[aria-label*='Mulai'], button[aria-label*='pembuatan'], button[aria-label*='forward']");
  // Fallback: press Enter
  await new Promise(r => setTimeout(r, 500));
  ab("press", "Enter");

  // Wait up to 120s for images (Nano Banana 2 ~30-60s)
  await new Promise(r => setTimeout(r, 5000));
  const urls = await waitForImages(1, 120_000);

  if (urls.length === 0) return { ok: false, error: "flow: generation timed out — no images appeared" };

  // Download first valid image
  for (const url of urls) {
    const buf = await downloadFlowImage(url);
    if (buf) {
      const mime = buf[0] === 0x89 ? "image/png" : "image/jpeg";
      return { ok: true, bytes: new Uint8Array(buf), mime, backend: "flow-nano-banana" };
    }
  }

  return { ok: false, error: "flow: download failed for all generated URLs" };
}
