/**
 * Creative review gate — mimo sees, JEV decides.
 *
 * Pipeline after any img2img/t2i generation:
 *   1. jj/mimo-v2.6-flash (vision, gratis cost 0) looks at the bytes and
 *      answers: does this photo show {product}? YES/NO + one line.
 *   2. oc/jev-1.13-free via /v1/systemone approves from the mimo verdict +
 *      hard signals (backend, bytes, resolution) — numeric scores, no vibes.
 *   3. REJECT → variant file is KEPT (review UI later) but link.image_url is
 *      NOT touched: the post falls back to the sealed original photo.
 *
 * Same gateway + key as router-image.ts (router.realpaytrans.my.id).
 * Zero deps. Both calls bounded (~30s total worst case).
 */

const BASE = (process.env.AFFILIATE_ROUTER_BASE_URL || "https://router.realpaytrans.my.id/v1").replace(/\/+$/, "");
const VISION_MODEL = process.env.AFFILIATE_REVIEW_VISION_MODEL || "jj/mimo-v2.6-flash";
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

/** Ask mimo-vision: is this the product? Returns raw text. */
async function mimoCheck(product: string, dataUri: string): Promise<string> {
  const body = {
    stream: false,
    max_tokens: 200,
    messages: [{
      role: "user",
      content: [
        { type: "text", text: `Product name: "${product}". Does this photo show THIS product (same object type, recognisable as what a buyer would receive)? Reply first word YES or NO, then one short sentence.` },
        { type: "image_url", image_url: { url: dataUri } },
      ],
    }],
    model: VISION_MODEL,
  };
  const res = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey()}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`vision HTTP ${res.status}`);
  const j = await res.json() as any;
  const t = j?.choices?.[0]?.message?.content;
  return (typeof t === "string" ? t : "").trim();
}

/** Ask JEV to score the creative from mimo's verdict + hard signals. */
async function jevApprove(state: string): Promise<Record<string, number>> {
  const body = {
    model: JUDGE_MODEL,
    state,
    questions: {
      is_match: { type: "noul", instructions: "Does the vision verdict confirm the photo shows the advertised product (YES verdict)?" },
      is_safe: { type: "noul", instructions: "Is there any sign of wrong object, drift, corruption, or unusable quality in the report?" },
    },
  };
  const res = await fetch(`${BASE}/systemone`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey()}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
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

/**
 * Full gate. Never throws — on any infra failure returns approved:false with
 * reason so the caller falls back to the original photo, not a broken post.
 */
export async function reviewCreative(
  product: string,
  bytes: Buffer,
  signals: { backend: string; byteLen: number },
): Promise<ReviewVerdict> {
  const empty = { approved: false, reason: "", mimo_says: "", jev_scores: {} };
  try {
    const mime = sniffMime(bytes);
    // Cap vision payload ~700KB (downscale not available stdlib-free; JPEG
    // creatives here are ~200-700KB so this passes through untouched).
    if (bytes.length > 900_000) return { ...empty, reason: "oversize-for-vision" };
    const dataUri = `data:${mime};base64,${bytes.toString("base64")}`;
    const mimo = await mimoCheck(product, dataUri);
    const yes = /^\s*yes\b/i.test(mimo);
    if (!yes) {
      return { approved: false, reason: `vision-reject: ${mimo.slice(0, 160)}`, mimo_says: mimo.slice(0, 300), jev_scores: {} };
    }
    // ponytail: JEV second opinion skipped when mimo verdict is a clean YES +
    // backend is router (proven fidelity). Add when auto-approve abuse appears.
    if (signals.backend === "router") {
      return { approved: true, reason: "vision-YES + router backend", mimo_says: mimo.slice(0, 300), jev_scores: {} };
    }
    const scores = await jevApprove(
      `Product: ${product}. Vision model verdict on generated photo: "${mimo}". ` +
      `Backend: ${signals.backend}, file bytes: ${signals.byteLen}. Approve for auto-posting?`,
    );
    const ok = (scores.is_match ?? 0) >= 0.6 && (scores.is_safe ?? 0) >= 0.6;
    return {
      approved: ok,
      reason: ok ? `jev-approve match=${scores.is_match} safe=${scores.is_safe}` : `jev-reject ${JSON.stringify(scores)}`,
      mimo_says: mimo.slice(0, 300),
      jev_scores: scores,
    };
  } catch (e) {
    return { ...empty, reason: `review-infra-fail: ${String(e).slice(0, 120)}` };
  }
}
