/**
 * Free image-to-image backend: the public Hugging Face Space
 * `kulkas2pintu/QWEN_EDIT_IMAGE` (Gradio API, no key required).
 *
 *   https://kulkas2pintu-qwen-edit-image.hf.space
 *
 * Why this exists: the 9router image route is down (502 on
 * /v1/images/generations, 500 on /v1/images/edits, /v1/models lists
 * `imageOutput: false` on all 130 entries). This Space answers, free, with
 * no API key — so recreateProductImage gets a fallback path that still does
 * real image-to-image with the product reference preserved.
 *
 * WHY this Space and not the others probed (see docs below):
 *   - prithivMLmods/qwen-image-edit-2511-loras-fast  -> ZeroGPU quota
 *     exhausted: "ZeroGPU worker error: AttributeError"
 *   - black-forest-labs/flux-1-kontext-dev.hf.space  -> "404: Session not found"
 *   - multimodalart/flux-lora-lab.hf.space           -> space up, but math
 *     rejects an image passed by URL (needs an upload path), and no
 *     free quota for a working img2img call
 *   - Pollinations (image.pollinations.ai)           -> 401: no-key generation
 *     discontinued
 * This one has a `preserve_identity` flag, which is the exact property the
 * product-recreation feature needs: the helmet stays the helmet.
 *
 * Gradio flow: upload the source to /gradio_api/upload, then POST the call
 * to /gradio_api/call/edit, then poll /gradio_api/call/edit/<event_id> for
 * `data:`. The result carries a `/gradio_api/file=...` URL to download.
 *
 * Override host for tests:
 *   AFFILIATE_HF_SPACE_BASE_URL (default https://kulkas2pintu-qwen-edit-image.hf.space)
 */

export type HfEditResult = { bytes: Buffer; mime: string };

const SPACE =
  process.env.AFFILIATE_HF_SPACE_BASE_URL || "https://kulkas2pintu-qwen-edit-image.hf.space";

/**
 * CPU-only img2img Space. Dedicated hardware — no ZeroGPU quota, no queue,
 * works 24/7 without a token. Slower (~2 min) and lower fidelity than the
 * Qwen Space, so it sits below it in the fallback chain.
 * Verified E2E: /tmp/helm-small.jpg -> 512x512 webp in 136s.
 */
const SDXL_SPACE =
  process.env.AFFILIATE_SDXL_SPACE_BASE_URL || "https://manjushri-sdxl-turbo-img2img-cpu.hf.space";

/** Drop-in for node Buffer at call sites; avoids depending on node:buffer. */
function toNodeBuffer(input: Uint8Array | ArrayBuffer): Buffer {
  if (Buffer.isBuffer(input)) return input;
  if (input instanceof Uint8Array) return Buffer.from(input);
  return Buffer.from(new Uint8Array(input));
}

const TIMEOUT_MS = Number(process.env.AFFILIATE_HF_SPACE_TIMEOUT_MS || 900_000);
const UPLOAD_TIMEOUT_MS = 120_000;
const POLL_MS = Number(process.env.AFFILIATE_HF_SPACE_POLL_MS || 4_000);

/** Upload `source` to a Space and return the server-side file path. */
async function uploadTo(space: string, source: Uint8Array): Promise<string> {
  const nodeBuf = toNodeBuffer(source);
  const form = new FormData();
  form.append("files", new Blob([nodeBuf], { type: "image/jpeg" }), "source.jpg");
  const res = await fetch(`${space}/gradio_api/upload`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`hf-space upload HTTP ${res.status}`);
  const json = (await res.json()) as string[];
  if (!Array.isArray(json) || !json[0]) throw new Error("hf-space upload returned no path");
  return json[0];
}

/** POST the /edit call, returns the event id. */
async function startEdit(
  imagePath: string,
  prompt: string,
  opts: { guidance: number; steps: number; identityStrength: number },
): Promise<string> {
  const img = { path: imagePath, meta: { path: imagePath } };
  const body = {
    data: [
      img,
      prompt,
      null,
      img,
      0,
      false,
      opts.guidance,
      opts.steps,
      true,
      opts.identityStrength,
      1024,
      false,
      false,
    ],
  };
  const res = await fetch(`${SPACE}/gradio_api/call/edit`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`hf-space call HTTP ${res.status}`);
  const json = (await res.json()) as { event_id?: string };
  if (!json.event_id) throw new Error("hf-space call returned no event_id");
  return json.event_id;
}

/** Poll until the event completes with `data:` or errors out. */
async function waitForResult(eventId: string): Promise<string> {
  const deadline = Date.now() + TIMEOUT_MS;
  for (;;) {
    if (Date.now() > deadline) throw new Error("hf-space edit timed out");
    const res = await fetch(`${SPACE}/gradio_api/call/edit/${eventId}`, {
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`hf-space poll HTTP ${res.status}`);
    const text = await res.text();
    if (text.startsWith("event: complete") || text.includes("\ndata:")) {
      const m = /data:\s*(\[[\s\S]*)/.exec(text);
      if (m) return m[1];
    }
    if (text.includes("event: error")) {
      const m = /data:\s*(\{[\s\S]*)/.exec(text);
      const detail = m ? m[1].slice(0, 200) : "unknown error";
      throw new Error(`hf-space edit failed: ${detail}`);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

/** Download the result file the event points at. */
async function downloadFile(fileUrl: string): Promise<Buffer> {
  const url = new URL(fileUrl.replace(/https?:\/\/[^/]+/, SPACE));
  const res = await fetch(url.toString(), {
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`hf-space download HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Recreate `source` with `prompt` on the free HF Space.
 * Returns PNG or JPEG bytes depending on what the Space produced.
 */
export async function qwenEditImage(
  source: Uint8Array,
  prompt: string,
  opts: { guidance?: number; steps?: number; identityStrength?: number } = {},
): Promise<HfEditResult> {
  const guidance = opts.guidance ?? 4;
  const steps = opts.steps ?? 8;
  const identityStrength = opts.identityStrength ?? 100;

  const uploadedPath = await uploadTo(SPACE, source);
  const eventId = await startEdit(uploadedPath, prompt, { guidance, steps, identityStrength });
  const raw = await waitForResult(eventId);

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new Error("hf-space result not JSON");
  }
  const first = (payload as Array<{ url?: string; path?: string } | null>)?.[0];
  if (!first?.url && !first?.path) throw new Error("hf-space result has no image");
  const bytes = await downloadFile(first.url || first.path!);
  const mime = /\.png(\?|$)/i.test(first.url || first.path || "") ? "image/png" : "image/jpeg";
  return { bytes, mime };
}

/** True when the Space is reachable and serving the Gradio API. */
export async function hfSpaceHealthy(): Promise<boolean> {
  try {
    const res = await fetch(`${SPACE}/gradio_api/info`, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return false;
    const json = (await res.json()) as { named_endpoints?: Record<string, unknown> };
    return Boolean(json.named_endpoints?.["/edit"]);
  } catch {
    return false;
  }
}

/**
 * Fallback provider: `manjushri-sdxl-turbo-img2img-cpu` — CPU hardware, no
 * ZeroGPU. Signature (5 args, /predict): source_img, prompt, steps, seed, Strength.
 *
 * The result arrives as `event: complete` with a `data: [...]` file payload;
 * Gradio heartbeats also contain the literal `data:`, so the poll checks for
 * `event: complete` specifically — matching only "data:" treats a heartbeat
 * as a result and reports a 500ms false success.
 */
export async function sdxlTurboImg2Img(
  source: Uint8Array,
  prompt: string,
  opts: { steps?: number; seed?: number; strength?: number; timeoutMs?: number } = {},
): Promise<HfEditResult> {
  const steps = opts.steps ?? 4;
  const seed = opts.seed ?? 42;
  const strength = opts.strength ?? 0.7;
  const timeoutMs = opts.timeoutMs ?? 600_000;

  const uploadedPath = await uploadTo(SDXL_SPACE, source);
  const img = { path: uploadedPath, meta: { _type: "gradio.FileData", path: uploadedPath } };
  const res = await fetch(`${SDXL_SPACE}/gradio_api/call/predict`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ data: [img, prompt, steps, seed, strength] }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`sdxl-space call HTTP ${res.status}`);
  const json = (await res.json()) as { event_id?: string };
  if (!json.event_id) throw new Error("sdxl-space call returned no event_id");

  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (Date.now() > deadline) throw new Error("sdxl-space edit timed out");
    const poll = await fetch(`${SDXL_SPACE}/gradio_api/call/predict/${json.event_id}`, {
      signal: AbortSignal.timeout(30_000),
    });
    if (!poll.ok) throw new Error(`sdxl-space poll HTTP ${poll.status}`);
    const text = await poll.text();
    if (text.includes("event: error")) throw new Error(`sdxl-space edit failed: ${text.slice(0, 200)}`);
    if (text.includes("event: complete")) {
      const m = /data:\s*(\[[\s\S]*)/.exec(text);
      if (!m) throw new Error("sdxl-space complete without data");
      const payload = JSON.parse(m[1]) as Array<{ url?: string; path?: string } | null>;
      const first = payload?.[0];
      if (!first?.url && !first?.path) throw new Error("sdxl-space result has no image");
      const bytes = await downloadFile(first.url || first.path!);
      const mime = /\.png(\?|$)/i.test(first.url || first.path || "") ? "image/png" : "image/jpeg";
      return { bytes, mime };
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

/** True when the CPU fallback Space is reachable and serving /predict. */
export async function sdxlSpaceHealthy(): Promise<boolean> {
  try {
    const res = await fetch(`${SDXL_SPACE}/gradio_api/info`, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return false;
    const json = (await res.json()) as { named_endpoints?: Record<string, unknown> };
    return Boolean(json.named_endpoints?.["/predict"]);
  } catch {
    return false;
  }
}
