/**
 * Image generation via the 9router "router2nd.realpaytrans.my.id" gateway.
 *
 * Two capabilities, both verified live:
 *
 *   1. generateImage(prompt)   -> text-to-image
 *      POST /v1/images/generations  {"model":"ag/gemini-3.1-flash-image", ...}
 *      Returns {"data":[{"b64_json":"..."}]} — a plain base64 JPEG.
 *
 *   2. recreateImage(imageUrl, prompt) -> image-to-image (product recreation)
 *      POST /v1/chat/completions with modalities ["image","text"] and the
 *      source image as an image_url content part.
 *
 *      The gateway does NOT return the image in a structured field. It comes
 *      back inline in message.content as a markdown data URI:
 *        ![image](data:image/jpeg;base64,/9j/4AA...)
 *      A structured-field parser reads `images[]`, finds nothing, and silently
 *      returns empty — so this module parses the markdown, and treats a missing
 *      data URI as a hard error.
 *
 * The key is read from the environment and never hardcoded:
 *   AFFILIATE_ROUTER_KEY       (preferred)
 *   HERMES_CUSTOM_ROUTER_REALPAYTRANS_MY_ID_API_KEY  (the Hermes router key, fallback)
 * Base URL is overridable for tests:
 *   AFFILIATE_ROUTER_BASE_URL  (default https://router2nd.realpaytrans.my.id/v1)
 */

export type GeneratedImage = {
  bytes: Buffer;
  mime: string;
  model: string;
};

const DEFAULT_BASE_URL = "https://router2nd.realpaytrans.my.id/v1";

/**
 * Image models on the gateway, best first.
 *
 * `ag/gemini-3.1-flash-image` is the reference model — verified working, and the
 * cheapest. It is a hidden alias: it does not appear in /v1/models. When its
 * upstream is exhausted (429 quota) or the alias itself dies (502, seen live),
 * the model below it is tried in order. All four were verified to return
 * b64_json from /v1/images/generations.
 *
 * Override the whole chain with AFFILIATE_ROUTER_IMAGE_MODELS (comma-separated).
 */
const DEFAULT_IMAGE_MODELS = [
  "ag/gemini-3.1-flash-image",
  "ag/gemini-3.8-flash",
  "ag/gemini-3.1-pro-low",
  "ag/gemini-3-flash",
  "ag/gemini-pro-agent",
];

/**
 * True when the failure belongs to the model/upstream rather than to the
 * request, i.e. a different model on the same gateway would be worth trying.
 */
function isModelUnavailable(status: number, json: any): boolean {
  const msg = String(json?.error?.message ?? json?.error ?? "");
  if (/quota|RESOURCE_EXHAUSTED|exhausted your capacity/i.test(msg)) return true;
  if (/does not support image generation/i.test(msg)) return true;
  // Upstream account/auth blocks. Not a request-shape error and not local —
  // another model on another provider may still answer.
  if (/verify your account|unauthenticated|invalid.*api.?key|permission denied|insufficient permission/i.test(msg)) return true;
  // Upstream names the model itself ("[antigravity/gemini-3.8-flash] [404]"),
  // i.e. the alias is not routable right now — the next model may be.
  if (status === 404 && /antigravity|gemini|model/i.test(msg)) return true;
  if (status === 429 || status === 502 || status === 503) return true;
  return false;
}

function baseUrl(): string {
  return (process.env.AFFILIATE_ROUTER_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function apiKey(): string {
  const key = process.env.AFFILIATE_ROUTER_KEY || process.env.HERMES_CUSTOM_ROUTER_REALPAYTRANS_MY_ID_API_KEY;
  if (!key) throw new Error("no router key: set AFFILIATE_ROUTER_KEY");
  return key;
}

function imageModels(): string[] {
  const raw = process.env.AFFILIATE_ROUTER_IMAGE_MODELS || DEFAULT_IMAGE_MODELS.join(",");
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

class RouterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RouterError";
  }
}

/** POST to the gateway with the bearer key; returns {status, json}. */
async function post(path: string, body: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`${baseUrl()}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey()}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { _raw: text.slice(0, 400) };
  }
  return { status: res.status, json };
}

const RETRIES = Number(process.env.AFFILIATE_ROUTER_RETRIES || 3);
const BACKOFF_MS = Number(process.env.AFFILIATE_ROUTER_RETRY_BACKOFF_MS || 1500);
const TIMEOUT_MS = Number(process.env.AFFILIATE_ROUTER_TIMEOUT_MS || 120_000);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The upstream GeoMs fail part of the time with
 *   {"code":400,"message":"User location is not supported for the API use."}
 * even for an identical payload that succeeds on the next attempt. It is
 * upstream region routing, not a payload error — so the only correct handling
 * is a bounded retry with backoff. Verified: 3 of 5 identical calls failed
 * before one succeeded; no request shape change makes it deterministic.
 */
function isRetryable(json: any): boolean {
  const msg = String(json?.error?.message ?? json?.error ?? "");
  return /not supported for the API use|location|region|overloaded|rate.?limit|50[0-9]/i.test(msg);
}

async function postRetrying(path: string, body: unknown): Promise<{ status: number; json: any }> {
  let last: { status: number; json: any } | null = null;
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    last = await post(path, body);
    if (last.status === 200 && !isRetryable(last.json)) return last;
    if (attempt < RETRIES && (isRetryable(last.json) || last.status >= 500)) {
      await sleep(BACKOFF_MS * attempt);
      continue;
    }
    return last;
  }
  return last!;
}

/**
 * Pull the image bytes out of a chat-completions response that carries it as a
 * markdown data URI in message.content.
 */
function extractInlineImage(content: unknown): { b64: string; mime: string } | null {
  if (typeof content !== "string") return null;
  // "#[image](data:image/jpeg;base64,.....)" — mime before the comma
  const m = /!\[[^\]]*\]\(data:([^;,]+);base64,([A-Za-z0-9+/=\s]+)\)/.exec(content);
  if (!m) return null;
  return { mime: m[1].trim(), b64: m[2].replace(/\s+/g, "") };
}

/**
 * Text-to-image. Walks the model chain: a model that answers 429/502/503 or
 * says it cannot generate images is skipped rather than failing the request.
 */
export async function generateImage(
  prompt: string,
  opts: { size?: string; outputFormat?: string } = {},
): Promise<GeneratedImage> {
  const failures: string[] = [];
  const body = {
    prompt,
    n: 1,
    size: opts.size || "1024x1024",
    output_format: opts.outputFormat || "png",
  };
  for (const m of imageModels()) {
    const { status, json } = await postRetrying("/images/generations", { ...body, model: m });
    if (status === 200 && json?.data?.[0]?.b64_json) {
      return {
        bytes: Buffer.from(json.data[0].b64_json, "base64"),
        mime: /image\/(\w+)/.exec(json.data[0].mime_type || "image/png")?.[1] === "jpeg" ? "image/jpeg" : "image/png",
        model: m,
      };
    }
    if (isModelUnavailable(status, json)) {
      failures.push(`${m}: HTTP ${status}`);
      continue;
    }
    throw new RouterError(`image generation failed: HTML ${status} ${JSON.stringify(json).slice(0, 300)}`);
  }
  throw new RouterError(`all image models unavailable: ${failures.join("; ")}`);
}

/**
 * Image-to-image: recreate a product photo.
 *
 * The source is passed by URL (or data URI) so the model needs to see the
 * original product to keep it identical.
 *
 * FIDELITY GUARD: only models PROVEN to honor the image reference may answer
 * here. `ag/gemini-3.8-flash` returns HTTP 200 with text ("AI cannot generate
 * raw pixels") and lower-chain models have been observed returning an inline
 * image of a COMPLETELY DIFFERENT product when they treat the call as t2i
 * (proven live: pump listing -> watch movement, backpack -> leather bag).
 * So img2img walks IMG2IMG_MODELS only; everything else is a hard miss and
 * the caller falls through to the product-name t2i path, which at least
 * generates the right product CLASS.
 */
const IMG2IMG_MODELS = (process.env.AFFILIATE_ROUTER_IMG2IMG_MODELS || "ag/gemini-3.1-flash-image")
  .split(",").map((s) => s.trim()).filter(Boolean);

export async function recreateImage(
  sourceImageUrl: string,
  prompt: string,
): Promise<GeneratedImage> {
  const failures: string[] = [];
  const body = {
    stream: false,
    modalities: ["image", "text"],
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: sourceImageUrl } },
        ],
      },
    ],
  };
  for (const m of IMG2IMG_MODELS) {
    const { status, json } = await postRetrying("/chat/completions", { ...body, model: m });
    if (status === 200) {
      const msg = json?.choices?.[0]?.message;
      const inline = extractInlineImage(msg?.content);
      if (inline) {
        return { bytes: Buffer.from(inline.b64, "base64"), mime: inline.mime, model: m };
      }
      // HTTP 200 but text-only reply: this model cannot do image output.
      failures.push(`${m}: no inline image (text-only reply)`);
      continue;
    }
    failures.push(`${m}: HTTP ${status}`);
  }
  throw new RouterError(`img2img unavailable: ${failures.join("; ")}`);
}
