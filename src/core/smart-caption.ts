/**
 * Smart caption — AI-written hook/why/cta that must pass the same hard rules
 * the deterministic template enforces (no brand spill, no unsourced claims,
 * link-in-bio, platform budgets). AI-first, template as fallback:
 *
 *   scheduler.preparePost -> smartCaption(link)  (1 call per slot, all
 *   platforms share the same product story — mirrors "one link per slot")
 *   -> validate() gate; ANY failure returns null and the caller keeps the
 *   template draft. A dead router must never stop a post.
 *
 * Hashtags/BIO_LINE are NOT left to the model — composeSmartBody appends the
 * platform's tag line (category tags + top-3 trending) exactly like the
 * template does, so the dedupe/budget rules stay in one place.
 *
 * Proven model pick (bench 2026-10-05, control pair helm/pompa/earbuds):
 * ag/gemini-3.8-flash — 0 brand spill, full structure, ~7s. Other candidates
 * were quota-exhausted (bdl/*), retired (claude-sonnet-4-6), or answered
 * empty (jj/qwen3.8-flash, gpt-oss). Chain stays overridable.
 */
import { buildIdentity, detectType } from "./product-identity.ts";
import { logActivity } from "./activity-log.ts";
import { typeLabel } from "./product-identity.ts";
import { BIO_LINE, tagsFor } from "./mystery-caption.ts";

const BASE = process.env.AFFILIATE_ROUTER_BASE_URL || "https://router2nd.realpaytrans.my.id/v1";
const CHAIN = (process.env.AFFILIATE_SMART_MODEL || "ag/gemini-3.8-flash,ag/gemini-3.7-flash,jj/qwen3.8-flash").split(",");

export type SmartStory = { hook: string; why: string; cta: string };

const SYSTEM = [
  "Kamu copywriter affiliate Shopee Indonesia. Tulis 3 paragraf caption social post (dipisah baris kosong):",
  "1) HOOK satu kalimat scroll-stopping tentang masalah/keinginan yang diselesaikan kategori produk ini.",
  "2) EDUKASI singkat — prinsip memilih atau fakta umum yang berguna untuk kategori ini. Bukan klaim tentang produk spesifik.",
  "3) CTA komunitas — ajak tag teman / sharing kebiasaan di komentar.",
  "ATURAN KERAS:",
  "- JANGAN PERNAH menulis merk, brand, nama model, atau nama toko. Kata kategori umum (helm, pompa ban, earbuds) boleh.",
  "- DILARANG mengklaim: harga, diskon, gratis ongkir, garansi, 'sudah dipakai', testimoni, angka penjualan.",
  "- Tanpa hashtag, tanpa link, tanpa emoji berlebihan (maks 1 emoji). Total MAKS 400 karakter.",
  "- Bahasa Indonesia santai. Balas HANYA 3 paragraf itu.",
].join("\n");

/** router2nd answers SSE frames even with stream:false — parse both shapes. */
function parseCompletion(txt: string): string {
  try {
    const j = JSON.parse(txt) as { choices?: { message?: { content?: string }; delta?: { content?: string } }[] };
    const c = j.choices?.[0]?.message?.content ?? j.choices?.[0]?.delta?.content;
    if (c) return c.trim();
  } catch { /* not plain JSON — try SSE */ }
  let out = "";
  for (const line of txt.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const p = line.slice(5).trim();
    if (!p || p === "[DONE]") continue;
    try {
      const j = JSON.parse(p) as { choices?: { delta?: { content?: string }; message?: { content?: string } }[] };
      out += j.choices?.[0]?.delta?.content ?? j.choices?.[0]?.message?.content ?? "";
    } catch { /* skip malformed frame */ }
  }
  return out.trim();
}

/** Words that leak the product: any ≥4-char token from the product name that
 *  is not a generic category word. The whitelist is conservative — better a
 *  false reject (template fallback) than a live brand spill. */
const GENERIC = new Set([
  "dan", "the", "untuk", "dengan", "bahan", "kualitas", "original", "resmi", "coding",
  "full", "face", "anti", "portable", "electric", "wireless", "bluetooth", "premium",
  "universal", "travel", "casual", "outdoor", "indoor", "mini", "big", "new", "hot",
  "pompa", "sepatu", "sneakers", "earbuds", "headphone", "headset", "speaker", "kabel",
  "tas", "dompet", "botol", "tumbler", "laptop", "mouse", "keyboard", "monitor", "ban",
  // common household/toy/gift nouns — Shopee titles capitalize them, but they
  // are description words, not brands; rejecting them caused silent fallbacks.
  "boneka", "lampu", "tidur", "kamar", "jam", "clock", "gift", "kado", "mainan",
  "capybara", "kapibara", "meja", "dinding", "anak", "lucu", "imut", "lembut",
  "game", "konsol", "stiker", "case", "kulkas", "kipas", "ac", "helm", "sepeda",
  "led", "oled", "ips", "usb", "hdmi", "lcd", "rgb", "api", "hd", "fhd", "aqi",
]);

/**
 * Tokens whose appearance in a caption = brand/model spill. Rules:
 *  - ALL-CAPS short codes (KYT, COD, XF) and anything containing a digit
 *    (RP28, 5000mah) are brand-ish even when short;
 *  - Capitalized words of >=5 chars that are not generic category words are
 *    brand names (Lenovo, Erazer) — EXCEPT the first word of the product
 *    string, which is almost always the category noun ("Pompa", "Helm"),
 *    and lowercase filler.
 * Over-inclusive is fine (false reject -> template fallback), misses are not.
 */
export function brandTokens(product: string | null): string[] {
  if (!product) return [];
  const words = product.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const out = new Set<string>();
  words.forEach((w, i) => {
    const lower = w.toLowerCase();
    if (GENERIC.has(lower)) return;
    if (w.length >= 2 && w === w.toUpperCase() && /[A-Z]/.test(w)) {
      // ALL-CAPS is a brand signal even at position 0 ("THTO Boneka ...");
      // title-case nouns at 0 ("Helm", "Pompa") are excluded by the check itself.
      return out.add(lower);
    }
    if (/\d/.test(w) && i > 0) return out.add(lower); // RP-V parts, XF28
    if (w[0] === w[0]?.toUpperCase() && w.length >= 5 && i > 0 && /[a-z]/.test(w.slice(1))) out.add(lower); // Lenovo
  });
  return Array.from(out);
}

/** Hard gate. Returns null when the text must not ship. */
export function validateStory(text: string, product: string | null): SmartStory | null {
  const paras = text.split(/\n\s*\n/).map((p) => p.replace(/\s+/g, " ").trim()).filter(Boolean);
  if (paras.length < 3) return null;
  const joined = paras.join("\n\n");
  if (joined.length > 460) return null; // platform ladder trims threads, this is the hard cap
  if (/@|(https?:)?\/\/|^www\./i.test(joined)) return null; // no links, no handles
  if (/#\w/.test(joined)) return null; // hashtags are appended by us, never the model
  if (/gratis\s*ongkir|diskon|garansi|\brp\s?[\d.]+\b|\b[\d.,]+\s?(rb|ribu|jt|juta)\b|harga\s*[\d,]+|omzet|terlaris|nomor\s*1/i.test(joined)) return null;
  if (/\b(sudah\s*(saya|aku)?\s*pakai|testimoni\s*(saya|aku))\b/i.test(joined)) return null;
  const spill = brandTokens(product);
  const low = joined.toLowerCase();
  for (const w of spill) if (low.includes(w)) return null;
  return { hook: paras[0]!, why: paras[1]!, cta: paras.slice(2).join(" ") };
}

async function callModel(model: string, user: string, key: string): Promise<string | null> {
  try {
    const r = await fetch(`${BASE}/chat/completions`, {
      method: "POST",
      signal: AbortSignal.timeout(30_000),
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: user },
        ],
        temperature: 0.9,
        max_tokens: 400,
        stream: false,
      }),
    });
    if (!r.ok) return null;
    const txt = await r.text();
    if (/quota is exhausted|no longer available/i.test(txt)) return null;
    const out = parseCompletion(txt);
    return out.length > 40 ? out : null;
  } catch {
    return null;
  }
}

/**
 * One AI story for the slot's link. Null = caller falls back to template.
 * Trends enter only as context words (the tag LINE is built by composeSmartBody
 * with the same dedupe rules as the template).
 */
export async function smartCaption(link: {
  product: string | null;
  kategori: string | null;
  shop?: string | null;
}, trendingTags: string[] = []): Promise<SmartStory | null> {
  const key = process.env.AFFILIATE_ROUTER_KEY;
  if (!key || process.env.AFFILIATE_SMART_CAPTION === "0") return null;
  const id = buildIdentity({ product: link.product, kategori: link.kategori, shop: link.shop ?? null });
  const type = detectType(id);
  const clue = typeLabel(type);
  const user =
    `Produk: ${link.product || clue} (kategori ${link.kategori || clue}).\n` +
    `Topik ramai (konteks CTA saja, jangan jadi hashtag): ${trendingTags.slice(0, 3).join(", ") || "-"}.\n` +
    `Tulis 3 paragraf. Nama/merk produk di atas TIDAK BOLEH muncul di tulisan.`;
  void id;
  for (const model of CHAIN) {
    const out = await callModel(model.trim(), user, key);
    if (!out) continue;
    const story = validateStory(out, link.product);
    if (story) return story;
    // silent fallback cost us a debug cycle (2026-10-05 slot 38908) — say why.
    logActivity({ level: "warn", source: "system", event: "caption.reject",
      message: `${model}: AI text failed validator (${whyReject(out, link.product)})` });
  }
  return null;
}

/** Human-readable first failed rule — mirrors validateStory order. */
export function whyReject(text: string, product: string | null): string {
  const paras = text.split(/\n\s*\n/).map((p) => p.replace(/\s+/g, " ").trim()).filter(Boolean);
  if (paras.length < 3) return "paras<3";
  const joined = paras.join("\n\n");
  if (joined.length > 460) return `oversize ${joined.length}`;
  if (/@|(https?:)?\/\/|^www\./i.test(joined)) return "link/handle";
  if (/#\w/.test(joined)) return "hashtag-inline";
  if (/gratis\s*ongkir|diskon|garansi|\brp\s?[\d.]+\b|\b[\d.,]+\s?(rb|ribu|jt|juta)\b|harga\s*[\d,]+|omzet|terlaris|nomor\s*1/i.test(joined)) return "claim/price";
  if (/\b(sudah\s*(saya|aku)?\s*pakai|testimoni\s*(saya|aku))\b/i.test(joined)) return "personal-claim";
  const low = joined.toLowerCase();
  for (const w of brandTokens(product)) if (low.includes(w)) return `spill:${w}`;
  return "unknown";
}

/** Compose the final body exactly like the template shape: 3 paras + BIO + tags. */
export function composeSmartBody(
  story: SmartStory,
  platform: "threads" | "instagram" | "facebook" | "x",
  type: string,
  trending: string[],
): string {
  const base = tagsFor(type);
  // trend tags arrive "#Motogp" from cachedTrends, but normalize anyway —
  // a hashtag without # is invisible to every platform parser.
  const norm = trending.map((t) => (t.startsWith("#") ? t : `#${t}`)).filter((t) => t.length > 1);
  const tags = [...base, ...norm.filter((t) => !base.includes(t))].slice(0, 6);
  const tagLine = tags.join(" ");
  if (platform === "threads") {
    const full = `${story.hook}\n\n${story.why}\n\n${story.cta}\n\n${BIO_LINE}\n\n${tagLine}`;
    const mid = `${story.hook}\n\n${story.why}\n\n${story.cta}\n\n${BIO_LINE}`;
    const short = `${story.hook}\n\n${story.why}\n\n${BIO_LINE}`;
    // publish paths append ~35 chars of short link — keep 460 like the template ladder
    return [full, mid, short].find((b) => b.length <= 425) ?? short;
  }
  return `${story.hook}\n\n${story.why}\n\n${story.cta}\n\n${BIO_LINE}\n\n${tagLine}`;
}
