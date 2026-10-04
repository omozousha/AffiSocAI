/**
 * Mystery caption builder.
 *
 * The product name never appears. The viewer gets a clue built only from data
 * we actually hold — the Shopee shop slug and the link's own category — and is
 * pushed to the bio link for the rest.
 *
 * Two rules the old templates broke, kept enforced here:
 *
 *   1. no claim we cannot source. No "gratis ongkir", no "bahan awet", no
 *      "sudah coba sendiri". Nothing vouches for the product; the caption only
 *      describes the category and withholds the name.
 *   2. no inline link. Instagram and Facebook keep the link on the bio page.
 */

import type { ContentRow } from "./store.ts";
import type { LinkInfo } from "./templates.ts";
import { buildIdentity, detectType } from "./product-identity.ts";
import { pickHook, type HookVariant } from "./product-hook.ts";
import { cachedTrends } from "./trends.ts";

export type MysteryDraft = {
  platform: "instagram" | "facebook" | "x" | "threads";
  body: string;
  bio_line: string;
  topic?: string | null;
  hashtags?: string[];
  constraints: string[];
};

export const BIO_LINE = "Link & detail lengkap ada di bio.";

export function categoryClue(kategori: string | null | undefined): string {
  const k = (kategori || "").toUpperCase();
  const m: Array<[RegExp, string]> = [
    [/FASHY|BAJU|PAKAIAN|KAOS|KEMEJA|DRESS|HOODIE|JAKET|CELANA|SHIRT/, "outfit"],
    [/SEPATU|SANDAL|SHOES|SNEAKERS|SLIPON/, "sepatu"],
    [/TAS|BAG|BACKPACK|RANSEL|DOMPET|WALLET/, "tas"],
    [/GADGET|ELEKTRONIK|HP|PHONE|CHARGER|EARPHONE|SPEAKER|HEADPHONE|MOUSE|KEYBOARD|KABEL/, "gadget"],
    [/KECANTIKAN|SKINCARE|BEAUTY|MAKEUP|SERUM|MOISTURIZER|TONER|SABUN/, "skincare"],
    [/MASAK|DAPUR|KITCHEN|PANCI|GEROBAK/, "alat dapur"],
    [/OUTDOOR|CAMPING|HIKING|TENDA|SLEEPING|MATRAS|LAMPU|KOBOKAYU/, "gear outdoor"],
    [/MAINAN|TOY|ANAK|BONEKA|LEGO|PUZZLE/, "mainan"],
    [/HR|HEALTH|SPORT|FITNESS|OLAHRAGA|BOLA|RAKET|DUMBBELL|YOGA/, "gear olahraga"],
    [/RUMAH|HOME|DEKOR|KASUR|BANTAL|KIPAS|PANCI/, "barang rumah"],
  ];
  for (const [re, word] of m) if (re.test(k)) return word;
  return "barang";
}

const CHAR_LIMIT: Record<MysteryDraft["platform"], number> = {
  x: 500,
  instagram: 2200,
  facebook: 60000,
  threads: 500,
};

function igMystery(hook: HookVariant, tags: string[]): string {
  return [
    hook.open,
    "",
    hook.why,
    "",
    hook.cta,
    "",
    BIO_LINE,
    "",
    tags.join(" "),
  ].join("\n");
}

function fbMystery(hook: HookVariant, tags: string[]): string {
  return [
    hook.open,
    "",
    hook.why,
    "",
    hook.cta,
    "",
    BIO_LINE,
    "",
    tags.join(" "),
  ].join("\n");
}

const TAGS: Record<string, string[]> = {
  helm: ["#helm", "#helmetlovers", "#rider", "#otomotif", "#linkdiobio"],
  gadget: ["#gadget", "#tech", "#setup", "#rekomendasi", "#linkdiobio"],
  rumah: ["#rumah", "#homedecor", "#kamaraesthetic", "#rekomendasi", "#linkdiobio"],
  fashion: ["#ootd", "#fashion", "#outfit", "#rekomendasi", "#linkdiobio"],
  skincare: ["#skincare", "#beauty", "#glowup", "#rekomendasi", "#linkdiobio"],
  sepatu: ["#sneakers", "#sepatu", "#ootd", "#rekomendasi", "#linkdiobio"],
  tas: ["#tas", "#bag", "#fashion", "#rekomendasi", "#linkdiobio"],
  outdoor: ["#outdoor", "#camping", "#hiking", "#pendaki", "#linkdiobio"],
  mainan: ["#mainan", "#toys", "#parenting", "#rekomendasi", "#linkdiobio"],
  olahraga: ["#olahraga", "#fitness", "#gym", "#sehat", "#linkdiobio"],
};

export function tagsFor(type: string): string[] {
  const base = TAGS[type] ?? ["#rekomendasi", "#belanjahemat", "#fyp", "#linkdiobio"];
  return base.includes("#linkdiobio") ? base : [...base, "#linkdiobio"];
}

/**
 * Threads topic_tag per product type — one tag per post, routes into the
 * topic feed (the API's equivalent of the composer's community picker).
 * Max 50 chars, no periods/ampersands. Must match a tag users follow.
 */
export function topicFor(type: string): string | null {
  // Capitalized: Meta renders the topic label capitalized in-app, and our
  // A/B test (Fashion vs fashion) showed both display as "Fashion".
  const m: Record<string, string> = {
    fashion: "Fashion",
    skincare: "Beauty",
    rumah: "Homedecor",
    outdoor: "Camping",
    mainan: "Toys",
    olahraga: "Fitness",
    sepatu: "Sneakers",
    tas: "Fashion",
    gadget: "Tech",
    helm: "Motorcycle",
  };
  return m[type] ?? null;
}

// Threads budget: 500 chars INCLUDING the short link line the publish paths
// append later (~35). Full shape = hook + one educational sentence + CTA,
// trimmed down gracefully until it fits.
const THREADS_BUDGET = 460;

function threadsMystery(hook: HookVariant, tags: string[]): string {
  const whyOne = hook.why.split(/\.\s+/)[0] + ".";
  const ctaShort = hook.cta.split(/\bLink di bio\b/)[0].trim();
  const ladder = [
    `${hook.open}\n\n${whyOne}\n\n${ctaShort}\n\n${BIO_LINE}\n\n${tags.join(" ")}`,
    `${hook.open}\n\n${whyOne}\n\n${BIO_LINE}\n\n${tags.join(" ")}`,
    `${hook.open}\n\n${BIO_LINE}\n\n${tags.join(" ")}`,
    `${hook.open}\n\n${BIO_LINE}`,
  ];
  return ladder.find((b) => b.length <= THREADS_BUDGET) ?? ladder[ladder.length - 1];
}

export function buildMysteryCaption(
  platform: MysteryDraft["platform"],
  link: LinkInfo,
  publishIndex: number = 0,
): MysteryDraft {
  const identity = buildIdentity({
    product: (link.product ?? null),
    kategori: (link as { kategori?: string | null }).kategori ?? null,
    shop: (link.shop ?? null),
  });
  const hook = pickHook(identity, publishIndex);
  const type = detectType(identity);
  // Hashtag line = topic tags for the product category + top-3 trending
  // (newsjack). Trends come from the scheduler prefetch cache; empty cache =
  // same behavior as before this feature.
  const trending = cachedTrends(3).map((t) => t.tag);
  const tags = [...tagsFor(type), ...trending.filter((tg) => !tagsFor(type).includes(tg))];
  const constraints: string[] = [];

  let body = "";
  let topic: string | null = null;
  let hashtags: string[] = [];

  if (platform === "threads") {
    // Topic goes via the API topic_tag param (official publish), never as
    // caption text — the composer's topic picker is metadata, not words.
    topic = topicFor(type);
    hashtags = tags;
    body = threadsMystery(hook, tags);
  } else if (platform === "instagram") {
    hashtags = tags;
    body = igMystery(hook, tags);
  } else if (platform === "facebook") {
    hashtags = tags;
    body = fbMystery(hook, tags);
  } else {
    hashtags = tags;
    body = threadsMystery(hook, tags);
  }

  if (body.length > CHAR_LIMIT[platform]) {
    body = body.slice(0, CHAR_LIMIT[platform] - 1);
    constraints.push(`truncated to ${CHAR_LIMIT[platform]} chars`);
  }

  return {
    platform,
    body,
    bio_line: BIO_LINE,
    topic,
    hashtags,
    constraints
  };
}

/** Which platforms the mystery builder currently covers. */
export const MYSTERY_PLATFORMS: MysteryDraft["platform"][] = ["instagram", "facebook", "x", "threads"];

/** Kind, kept aligned with the ContentRow shape so drafts stay storable. */
export function mysteryKind(mediaUrl: string | null | undefined): ContentRow["kind"] {
  return mediaUrl ? "image" : "text";
}
