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
import { recreateImage, generateImage } from "./router-image.ts";
import { updateLinkImage } from "./store.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.AFFILIATE_DATA_DIR || join(HERE, "..", "..", "data");
const IMAGE_DIR = process.env.AFFILIATE_IMAGE_DIR || join(DATA_DIR, "images");
const MAX_SOURCE_BYTES = 8 * 1024 * 1024;

export type RecreateResult =
  | { ok: true; path: string; file: string; served_url: string; prompt: string; mode: "image-to-image" | "text-to-image" }
  | { ok: false; error: string };

/**
 * The default prompt. `kategori` shifts the setting to something plausible for
 * the product class — apparel photographed flat, gear photographed outdoors.
 */
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

/** Fetch a remote image into a buffer so it can be sent as a data URI. */
async function fetchSource(url: string): Promise<Buffer | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { "User-Agent": "Twitterbot/1.0" } });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 2_000 || buf.length > MAX_SOURCE_BYTES) return null;
    return buf;
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
export async function recreateProductImage(link: LinkRow, promptText?: string): Promise<RecreateResult> {
  const prompt = (promptText && promptText.trim()) || defaultRecreatePrompt(link);
  await mkdir(IMAGE_DIR, { recursive: true });

  let result: { bytes: Uint8Array; mime: string } | null = null;
  let mode: "image-to-image" | "text-to-image" = "text-to-image";

  const source = await fetchSource(link.image_url || "");
  if (source) {
    const mime = sniff(source);
    if (mime) {
      try {
        result = await recreateImage(`data:${mime};base64,${source.toString("base64")}`, prompt);
        mode = "image-to-image";
      } catch (e) {
        console.error("[recreate] image-to-image failed:", String(e).slice(0, 200));
        result = null;
      }
    }
  }

  // Fallback: a fresh generation from the product name alone. Worse fidelity,
  // but a valid post image beats no image at all.
  if (!result) {
    try {
      result = await generateImage(prompt);
      mode = "text-to-image";
    } catch (e) {
      return { ok: false, error: `image generation failed: ${String(e).slice(0, 300)}` };
    }
  }

  const ext = result.mime === "image/png" ? "png" : result.mime === "image/webp" ? "webp" : "jpg";
  const file = `link-${link.id}-${Date.now()}.${ext}`;
  const path = join(IMAGE_DIR, file);
  await writeFile(path, Buffer.from(result.bytes));

  const served = `/api/images/${file}`;
  try {
    updateLinkImage(link.id, served);
  } catch (e) {
    console.error("[recreate] could not persist image_url:", String(e).slice(0, 200));
  }

  return { ok: true, path, file, served_url: served, prompt, mode };
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
