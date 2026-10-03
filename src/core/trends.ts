/**
 * Live trending topics (newsjacking).
 *
 * Before each post we pull the top trending queries for Indonesia from
 * Google Trends' public RSS (geo=ID, no auth) and append them as hashtags —
 * riding traffic you did not have to earn. Different subject than the product
 * is fine (operator directive); we still never post onto human tragedy.
 *
 * Design rules:
 *   - fetchTopTrends() is async with a 15-min in-memory cache; a failed fetch
 *     returns the previous (possibly empty) list — the posting path NEVER
 *     blocks or breaks because a trend provider is down.
 *   - the scheduler prefetches at boot and per tick so buildMysteryCaption's
 *     sync readers get the cache instantly.
 *   - blocklist: death/disaster/crime words are filtered — a caption must not
 *     appear to farm victims or atrocities.
 */

const RSS = "https://trends.google.com/trending/rss?geo=ID";
const TTL_MS = 15 * 60 * 1000;

export type Trend = { query: string; tag: string; traffic: string };

let cache: { at: number; trends: Trend[] } = { at: 0, trends: [] };

/** Words that make a trend off-limits for commerce content. */
const BLOCK = [
  "mati", "meninggal", "wafat", "tewas", "mayat", "bunuh", "korban", "jenazah",
  "gempa", "banjir", "longsor", "tsunami", "kecelakaan", "bencana", "teroris",
  "bom", "tembak", "rudapaksa", "cabul", "pemerkosaan", "skandal", "diculik",
  "hilang", "tenggelam", "kebakaran", "ledakan", "virus", "wabah", "kematian",
];

/** Junk a feed can contain that must never become a hashtag. */
const NOISE = ["video", "videos", "trending", "search", "google", "youtube"];

/** Query text -> safe hashtag: strip noise, camel-join words, quality-gated. */
export function toTag(q: string): string {
  const words = q
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1)
    .slice(0, 3);
  if (words.length === 0) return "";
  const joined = words.map((w) => w[0]!.toUpperCase() + w.slice(1)).join("");
  // quality gate: <4 chars (feeds full of "Bkn"-type acronyms) or >24 reads like spam
  if (joined.length < 4 || joined.length > 24) return "";
  if (NOISE.some((n) => joined.toLowerCase() === n)) return "";
  if (/^\d+$/.test(joined)) return "";
  return joined;
}

function blocked(q: string): boolean {
  const s = q.toLowerCase();
  return BLOCK.some((b) => s.includes(b));
}

/** Parse the RSS without a DOM lib: item/title + ht:approx_traffic. */
function parseRss(xml: string): Trend[] {
  const out: Trend[] = [];
  const items = xml.split("<item>").slice(1);
  for (const it of items) {
    const title = /<title>([^<]*)<\/title>/.exec(it)?.[1]?.trim() ?? "";
    const traffic = /<ht:approx_traffic>([^<]*)<\/ht:approx_traffic>/.exec(it)?.[1]?.trim() ?? "";
    if (!title || blocked(title)) continue;
    const tag = toTag(title);
    if (!tag) continue;
    out.push({ query: title, tag: `#${tag}`, traffic });
  }
  return out;
}

/** Top-N current trends for ID (cached). Never throws, never blocks >~2s. */
export async function fetchTopTrends(n = 3): Promise<Trend[]> {
  const now = Date.now();
  if (now - cache.at < TTL_MS) return cache.trends.slice(0, n);
  try {
    const r = await fetch(RSS, { signal: AbortSignal.timeout(2500) });
    if (r.ok) {
      const parsed = parseRss(await r.text());
      if (parsed.length > 0) cache = { at: now, trends: parsed };
    }
  } catch { /* provider down — keep the previous cache */ }
  return cache.trends.slice(0, n);
}

/** Sync read for the caption builder — whatever the prefetch last cached. */
export function cachedTrends(n = 3): Trend[] {
  return cache.trends.slice(0, n);
}
