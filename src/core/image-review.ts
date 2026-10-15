/**
 * Creative review gate — mimo sees, JEV decides.
 *
 * Pipeline after any img2img/t2i generation:
 *   1. jj/mimo-v2.6-flash (vision, gratis cost 0) looks at the bytes and
 *      answers: does this photo show {product}? YES/NO + one line.
 *   2. oc/jev-1.13-free via /v1/systemone approves from the mimo verdict +
 *      hard signals (backend, bytes, resolution) — numeric scores, no vibes.
 *   3. REJECT -> variant file is KEPT (review UI later) but link.image_url is
 *      NOT touched: the post falls back to the sealed original photo.
 *
 * Same gateway + key as router-image.ts (router.realpaytrans.my.id).
 * Zero deps. Both calls bounded (~30s total worst case).
 */

const BASE = (process.env.AFFILIATE_ROUTER_BASE_URL || "https://router.realpaytrans.my.id/v1").replace(/\/+$/, "");
// 2026-10-03: mimo (openai provider) dead on router2nd — 403/404 "Edge
// unavailable"/"No active credentials". Proven control-pair replacement:
// ag/gemini-3.8-flash (YES on pump, NO on backpack). Old mimo kept as
// automatic fallback via AFFILIATE_REVIEW_VISION_MODEL if it revives.
const VISION_MODELS = (process.env.AFFILIATE_REVIEW_VISION_MODEL ||
  "ag/gemini-3.8-flash,jj/mimo-v2.6-flash").split(",").map((s) => s.trim()).filter(Boolean);
const JUDGE_MODEL = "oc/jev-1.13-free";

function apiKey(): string {
  const k = process.env.AFFILIATE_ROUTER_KEY || process.env.HERMES_CUSTOM_ROUTER_REALPAYTRANS_MY_ID_API_KEY;
  if (!k) throw new Error("no router key");
  return k;
}

export type ReviewVerdict = {
  approved: boolean;
  reason: string;
  mimo_says: string;
  jev_scores: Record<string, number>;
};

async function mimoCheck(product: string, dataUri: string): Promise<string> {
  const body = (model: string) => ({
    stream: false,
    max_tokens: 200,
    messages: [{
      role: "user",
      content: [
        { type: "text", text: `Product name: "${product}". Does this photo show THIS product (same object type, recognisable as what a buyer would receive)? Reply first word YES or NO, then one short sentence.` },
        { type: "image_url", image_url: { url: dataUri } },
      ],
    }],
    model,
  });
  // Try each configured vision model; a dead route (HTTP error / no choices /
  // quota-gate text) moves to the next. Only if ALL are dead it throws and the
  // caller classifies review-infra-fail.
  let lastErr = "no vision model configured";
  for (const model of VISION_MODELS) {
    try {
      const res = await fetch(`${BASE}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey()}` },
        body: JSON.stringify(body(model)),
        signal: AbortSignal.timeout(90_000),
      });
      if (!res.ok) { lastErr = `vision ${model} HTTP ${res.status}`; continue; }
      const j = await res.json() as any;
      if (j?.error) { lastErr = `vision ${model}: ${String(j.error?.message ?? j.error).slice(0, 80)}`; continue; }
      const t = j?.choices?.[0]?.message?.content;
      const s = (typeof t === "string" ? t : "").trim();
      if (!s) { lastErr = `vision ${model}: empty`; continue; }
      if (/quota is exhausted|API key required|insufficient credit/i.test(s)) { lastErr = `vision ${model}: quota-gate`; continue; }
      return s;
    } catch (e) {
      lastErr = `vision ${model}: ${String(e).slice(0, 60)}`;
    }
  }
  throw new Error(lastErr);
}

async function jevApprove(state: string): Promise<Record<string, number>> {
  const body = {
    model: JUDGE_MODEL,
    state,
    questions: {
      is_match: { type: "noul", instructions: "Does the vision verdict confirm the photo shows the advertised product (YES verdict)?" },
      is_safe: { type: "noul", instructions: "Given the report, is the photo clean and usable for auto-posting — correct object, no drift, no corruption, acceptable quality?" },
      is_shape_locked: { type: "noul", instructions: "Does the generated image keep the same object shape, silhouette, edges and component layout as the reference product? 0 = completely changed, 1 = preserved." },
      is_color_locked: { type: "noul", instructions: "Does the generated image keep the same dominant colours and material tones as the reference product? 0 = recolored, 1 = preserved." },
    },
  };
  const res = await fetch(`${BASE}/systemone`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey()}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) throw new Error(`systemone HTTP ${res.status}`);
  const j = await res.json() as any;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries<any>(j?.answers ?? {})) {
    if (typeof v?.noul === "number") out[k] = v.noul;
  }
  return out;
}

async function jevApproveWithFidelity(product: string, mimo: string, signals: { backend: string; byteLen: number }): Promise<Record<string, number>> {
  const state = `Product: ${product}. Vision verdict: "${mimo}". Backend: ${signals.backend}, bytes: ${signals.byteLen}. Judge this image for auto-posting with hard fidelity checks.`;
  const body = {
    model: JUDGE_MODEL,
    state,
    questions: {
      is_match: { type: "noul", instructions: "Does the vision verdict confirm the photo shows the advertised product?" },
      is_safe: { type: "noul", instructions: "Is the photo clean and usable for auto-posting: correct object, no drift, no corruption, acceptable quality?" },
      is_shape_locked: { type: "noul", instructions: "Does the image preserve the reference product's shape, silhouette, edges, component layout and proportions? 0 = changed, 1 = preserved." },
      is_color_locked: { type: "noul", instructions: "Does the image preserve the reference product's dominant colours and material tones? 0 = recolored, 1 = preserved." },
    },
  };
  const res = await fetch(`${BASE}/systemone`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey()}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) throw new Error(`systemone HTTP ${res.status}`);
  const j = await res.json() as any;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries<any>(j?.answers ?? {})) {
    if (typeof v?.noul === "number") out[k] = v.noul;
  }
  return out;
}

function sniffMime(buf: Buffer): string {
  if (buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50) return "image/png";
  if (buf[0] === 0x52 && buf[1] === 0x49) return "image/webp";
  return "image/jpeg";
}

export async function reviewCreative(
  product: string,
  bytes: Buffer,
  signals: { backend: string; byteLen: number },
): Promise<ReviewVerdict> {
  const empty = { approved: false, reason: "", mimo_says: "", jev_scores: {} };
  try {
    const mime = sniffMime(bytes);
    if (bytes.length > 4_000_000) return { ...empty, reason: "review-infra-fail: oversize-for-vision" };
    const dataUri = `data:${mime};base64,${bytes.toString("base64")}`;
    const mimo = await mimoCheck(product, dataUri);
    if (/quota\s+is\s+exhausted|API key required|insufficient credit/i.test(mimo)) {
      return { ...empty, reason: `review-infra-fail: vision-quota-gate: ${mimo.slice(0, 120)}` };
    }
    const yes = /^\s*yes\b/i.test(mimo);
    if (!yes) {
      return { approved: false, reason: `vision-reject: ${mimo.slice(0, 160)}`, mimo_says: mimo.slice(0, 300), jev_scores: {} };
    }

    const jev = await jevApproveWithFidelity(product, mimo, signals);
    const ok = (jev.is_match ?? 0) >= 0.6 && (jev.is_safe ?? 0) >= 0.6 && (jev.is_shape_locked ?? 0) >= 0.6 && (jev.is_color_locked ?? 0) >= 0.6;
    const reason = ok
      ? `jev-approve match=${jev.is_match} safe=${jev.is_safe} shape=${jev.is_shape_locked} color=${jev.is_color_locked}`
      : `jev-reject ${JSON.stringify(jev)}`;
    return {
      approved: ok,
      reason,
      mimo_says: mimo.slice(0, 300),
      jev_scores: jev,
    };
  } catch (e) {
    return { ...empty, reason: `review-infra-fail: ${String(e).slice(0, 120)}` };
  }
}
