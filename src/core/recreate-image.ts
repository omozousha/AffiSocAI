/**
 * Product image recreation.
 *
 * Takes the product's own photo (the Shopee `og:image`) and produces a clean,
 * post-ready version: the original product, restyled. The product is preserved —
 * what changes is background, lighting and framing. That is the whole point:
 * an affiliate photo that looks like stock photography, while still being
 * recognisably the product the buyer will receive.
 *
 * Backend: the free Google image model on the 9router gateway
 * (router.realpaytrans.my.id), model `ag/gemini-3.1-flash-image`. It is not
 * listed in /v1/models — it is a hidden alias that works when called directly,
 * which is why the model name is a constant here and not read from the models
 * list.
 *
 * Output lands in data/images/ so the result is durable and servable by the API
 * without a third-party referrer check on the CDN.
 */

import { writeFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { LinkRow } from "./store.ts";
import { buildIdentity } from "./product-identity.ts";
import { imagePromptFor } from "./product-hook.ts";
import { recreateImage, generateImage } from "./router-image.ts";
import { updateLinkImage } from "./store.ts";
import { reviewCreative, type ReviewVerdict } from "./image-review.ts";
import { flowGenerateImage } from "./flow-image.ts";
import { flowStatus } from "./flow-auth.ts";
import { presetPrompt, DEFAULT_PRESET, findPreset, PREMIUM_IMG2IMG_PROMPT } from "./image-presets.ts";
import { qwenEditImage, sdxlTurboImg2Img, hfSpaceHealthy, sdxlSpaceHealthy } from "./hf-space-image.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.AFFILIATE_DATA_DIR || join(HERE, "..", "..", "data");
const IMAGE_DIR = process.env.AFFILIATE_IMAGE_DIR || join(DATA_DIR, "images");
const MAX_SOURCE_BYTES = 8 * 1024 * 1024;

export type RecreateResult =
  | {
      ok: true;
      path: string;
      file: string;
      served_url: string;
      prompt: string;
      mode: "image-to-image" | "text-to-image";
      backend: ImageBackend | null;
      preset: string;
      aspect: string;
      /** Which reference photo was used (original CDN vs current image). */
      ref_used: string | null;
      /** Review gate outcome — mimo sees, JEV decides. */
      review: ReviewVerdict;
      /** False when the creative failed review: file kept, image_url untouched. */
      live: boolean;
    }
  | { ok: false; error: string };

/** Which backend produced the image. Surfaced so an operator can tell a
 *  low-fidelity CPU result from a proper one. */
export type ImageBackend = "router" | "hf-qwen" | "hf-sdxl" | "router-t2i" | "flow-nano-banana";

/**
 * Health probe for the chain. The router is the primary backend and answers
 * in ~15s, so it is probed by GET-free means: a real call is cheap enough.
 * ZeroGPU is excluded here — a probe would itself burn quota.
 */
async function pickBackend(): Promise<{ router: boolean; qwen: boolean; sdxl: boolean }> {
  const [qwen, sdxl] = await Promise.all([hfSpaceHealthy(), sdxlSpaceHealthy()]);
  return { router: true, qwen, sdxl };
}

/**
 * The default prompt. `kategori` shifts the setting to something plausible for
 * the product class — apparel photographed flat, gear photographed outdoors.
 */
// product-aware hook (overrides category-only branch when name is present)
export function defaultRecreatePromptProductAware(link: LinkRow): string {
  const id = buildIdentity({ product: link.product ?? null, kategori: link.kategori ?? null, shop: link.shop ?? null });
  return imagePromptFor(id);
}

export function defaultRecreatePrompt(link: LinkRow): string {
  const name = (link.product || "this product").trim();
  const k = (link.kategori || "").toUpperCase();
  const setting =
    k.includes("FASHY") || k.includes("BAJU") || k.includes("PAKAIAN")
      ? "on a clean neutral studio backdrop with soft diffused lighting"
      : k.includes("OUTDOOR") || k.includes("GADGET") || k.includes("ELEKTRONIK")
        ? "on a light grey seamless surface with a subtle open 3-product flat-lay composition, soft shadow"
        : "on a pure white seamless studio background with soft directional lighting and a clean drop shadow";
  return [
    `Professional e-commerce product photograph of ${name}.`,
    `Keep the product exactly as in the reference image — same design, colours, labels and proportions.`,
    `Photograph it ${setting}.`,
    "Sharp focus, high detail, commercial catalogue quality, no text, no watermark, no logo overlay.",
  ].join(" ");
}

/**
 * Resolve the source image for a link into bytes + mime.
 *
 * `image_url` may be a remote http(s) URL (the Shopee og:image, the real
 * reference), or a local `/api/images/...` path (a previously generated
 * result). Both are valid inputs — a re-run of a preset rebuilds from the
 * current image, which is what an operator editing a product expects.
 * The remote path is what makes the product authentic, so it is tried first.
 */
async function fetchSource(url: string): Promise<Buffer | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);
  try {
    if (/^https?:\/\//i.test(url)) {
      const res = await fetch(url, { signal: controller.signal, headers: { "User-Agent": "Twitterbot/1.0" } });
      if (!res.ok) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 2_000 || buf.length > MAX_SOURCE_BYTES) return null;
      return buf;
    }
    // Local served path: /api/images/<file> -> data/images/<file>
    if (url.startsWith("/api/images/")) {
      const file = url.slice("/api/images/".length);
      if (!/^[\w.-]+$/.test(file)) return null;
      const buf = await readFile(join(IMAGE_DIR, file));
      if (buf.length < 2_000 || buf.length > MAX_SOURCE_BYTES) return null;
      return buf;
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function sniff(buf: Buffer): string | null {
  if (buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50) return "image/png";
  if (buf[0] === 0x47 && buf[1] === 0x49) return "image/gif";
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46) return "image/webp";
  return null;
}

/**
 * Recreate the product image for a stored link and persist it.
 *
 * `image_url` is updated to the local served path, so the bio page and the
 * content generator both pick up the recreated image later.
 */
export async function recreateProductImage(
  link: LinkRow,
  promptText?: string,
  presetId?: string,
): Promise<RecreateResult> {
  // An explicit prompt from the operator wins; otherwise the premium
  // image-to-image master prompt (verbatim — the reference photo carries
  // the product identity), unless a non-default preset was chosen.
  const label = (link.product || "this product").trim();
  const prompt =
    (promptText && promptText.trim())
    || (presetId && presetId !== DEFAULT_PRESET
      ? presetPrompt(presetId, label, link.kategori)
      : PREMIUM_IMG2IMG_PROMPT);
  const preset = findPreset(presetId);
  await mkdir(IMAGE_DIR, { recursive: true });

  let result: { bytes: Uint8Array; mime: string } | null = null;
  let mode: "image-to-image" | "text-to-image" = "text-to-image";
  let backend: ImageBackend | null = null;

  // Reference priority: the sealed ORIGINAL Shopee photo first (the true
  // product), then the current image. Regenerating from a previous creative
  // drifts the product every cycle — that is how a chair becomes a shoe.
  const refs = [link.image_original, link.image_url].filter((u): u is string => !!u);
  let source: Buffer | null = null;
  let refUsed: string | null = null;
  for (const ref of refs) {
    source = await fetchSource(ref);
    if (source) { refUsed = ref; break; }
  }
  if (source) {
    const mime = sniff(source);
    if (mime) {
      const dataUri = `data:${mime};base64,${source.toString("base64")}`;
      const backends = await pickBackend();

      // 0. Flow Nano Banana 2 — best quality, text-to-image via browser session.
      //    Activated when cookies are present. Falls through on failure.
      const fs = flowStatus();
      if (fs.live && (fs.daysLeft ?? 0) > 0) {
        try {
          const fr = await flowGenerateImage(prompt);
          if (fr.ok) {
            result = { bytes: fr.bytes, mime: fr.mime };
            mode = "text-to-image";
            backend = "flow-nano-banana";
          }
        } catch (e) {
          console.error("[recreate] flow nano-banana failed:", String(e).slice(0, 160));
        }
      }

      // 1. Router img2img — best fidelity (~15s), 1024px.
      //    It fails transiently (429/502/503 during upstream exhaustion), so
      //    retry once before declaring it down.
      for (let attempt = 1; attempt <= 2 && !result; attempt++) {
        try {
          result = await recreateImage(dataUri, prompt);
          mode = "image-to-image";
          backend = "router";
        } catch (e) {
          console.error(`[recreate] router img2img attempt ${attempt} failed:`, String(e).slice(0, 160));
          if (attempt === 1) await new Promise((r) => setTimeout(r, 1500));
        }
      }

      // 2. HF Qwen Space — skipped when AFFILIATE_IMG_BACKEND=gemini
      //    (operator choice: Gemini only until an alternative is found).
      if (!result && backends.qwen && process.env.AFFILIATE_IMG_BACKEND !== "gemini") {
        try {
          result = await qwenEditImage(source, prompt);
          mode = "image-to-image";
          backend = "hf-qwen";
        } catch (e) {
          console.error("[recreate] hf-qwen img2img failed:", String(e).slice(0, 160));
        }
      }

      // 3. HF SDXL CPU — skipped when AFFILIATE_IMG_BACKEND=gemini
      //    (operator choice: Gemini only until an alternative is found).
      if (!result && backends.sdxl && process.env.AFFILIATE_IMG_BACKEND !== "gemini") {
        try {
          result = await sdxlTurboImg2Img(source, prompt);
          mode = "image-to-image";
          backend = "hf-sdxl";
        } catch (e) {
          console.error("[recreate] hf-sdxl img2img failed:", String(e).slice(0, 160));
        }
      }
    }
  }

  // Fallback: a fresh generation from the product name alone. Worse fidelity,
  // but a valid post image beats no image at all.
  if (!result) {
    try {
      result = await generateImage(prompt);
      mode = "text-to-image";
      backend = "router-t2i";
    } catch (e) {
      return { ok: false, error: `image generation failed: ${String(e).slice(0, 300)}` };
    }
  }

  const ext = result.mime === "image/png" ? "png" : result.mime === "image/webp" ? "webp" : "jpg";
  const file = `link-${link.id}-${Date.now()}.${ext}`;
  const path = join(IMAGE_DIR, file);
  const buf = Buffer.from(result.bytes);
  await writeFile(path, buf);

  // REVIEW GATE: mimo sees the bytes, JEV approves (non-router backends).
  // Rejected creative stays on disk for the review UI, but image_url is NOT
  // touched — the post falls back to the sealed original photo.
  const review = await reviewCreative(link.product || "", buf, {
    backend: backend ?? "unknown",
    byteLen: buf.length,
  });
  const served = `/api/images/${file}`;
  const live = review.approved || process.env.AFFILIATE_REVIEW_BYPASS === "1";
  if (live) {
    try {
      updateLinkImage(link.id, served);
    } catch (e) {
      console.error("[recreate] could not persist image_url:", String(e).slice(0, 200));
    }
  } else {
    console.warn(`[recreate] review REJECT link ${link.id} (${backend}): ${review.reason} — file kept, original photo stays live`);
  }

  return {
    ok: true,
    path,
    file,
    served_url: served,
    prompt,
    mode,
    backend,
    preset: preset.id,
    aspect: preset.aspect,
    ref_used: refUsed,
    review,
    live,
  };
}

/** Epoch ms when the premium master prompt went live — creatives older than
 *  this get one regeneration so the cron converges to the premium style. */
export const PREMIUM_CUTOFF_MS = Date.now();

/** True when the link's stored creative predates the premium prompt. */
export async function needsPremiumRegen(link: LinkRow): Promise<boolean> {
  const url = link.image_url || "";
  const m = url.match(/link-\d+-(\d+)\.(jpg|jpeg|png|webp)$/i);
  if (!m) return false;
  const ts = Number(m[1]);
  if (!Number.isFinite(ts)) return false;
  if (ts >= PREMIUM_CUTOFF_MS) return false;
  // Confirm the file exists locally (remote CDN names never match anyway).
  const file = url.slice(url.lastIndexOf("/") + 1);
  if (!/^[\w.-]+$/.test(file)) return false;
  return await readStoredImage(file).then((r) => r !== null);
}

/** Read a stored image back out of data/images/. Used by GET /api/images/:file. */
export async function readStoredImage(file: string): Promise<{ buf: Buffer; mime: string } | null> {
  if (!/^[\w.-]+$/.test(file)) return null;
  const path = join(IMAGE_DIR, file);
  const buf = await readFile(path).catch(() => null);
  if (!buf) return null;
  const mime = sniff(buf);
  if (!mime) return null;
  return { buf: buf as Buffer, mime };
}
