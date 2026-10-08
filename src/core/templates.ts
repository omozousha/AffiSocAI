/**
 * Content templates — deterministic, no LLM call.
 *
 * Templates are built from whatever is actually known about a link: the Shopee
 * shop slug and item id. Unknown fields stay blank rather than being invented;
 * a caption that claims details it cannot source is worse than a short one.
 */

import type { ContentRow } from "./store.ts";
import { buildIdentity, detectType } from "./product-identity.ts";

/** Generic category word per product type — no brand, no item name. */
const CATEGORY_WORD: Record<string, string> = {
  helm: "helm", gadget: "gadget", rumah: "peralatan rumah",
  skincare: "skincare", fashion: "outfit", sepatu: "sepatu",
  tas: "tas", motor: "aksesoris motor", olahraga: "perlengkapan olahraga",
  mainan: "mainan", makanan: "camilan",
};

export type LinkInfo = {
  short_url: string;
  resolved_url: string | null;
  shopee_shop_id: string | null;
  shopee_item_id: string | null;
  shop: string | null;
  /** Real product name, taken from og:title when it could be fetched. */
  product?: string | null;
  /** Product image URL (og:image), must be Meta-fetchable. */
  image_url?: string | null;
  /** AI-guessed product category (16 fixed labels), null when unknown. */
  kategori?: string | null;
  /** Bio-link sheet row number — lets the caption tell viewers which item to find. */
  sheet_id?: number | null;
};

export type Draft = {
  platform: "instagram" | "facebook" | "x";
  kind: ContentRow["kind"];
  body: string;
  /** IG/FB cannot post a bare link caption well; the link lives on the bio page. */
  linkPlacement: "bio";
  /** Reserved: kept for shape compatibility. No first-comment path exists — the IG toolkit has no create-comment action. */
  firstComment: string | null;
  media_url: string | null;
  needsMedia: boolean;
  notes: string[];
};

const CHAR_LIMIT: Record<Draft["platform"], number> = {
  x: 280,
  instagram: 2200,
  facebook: 60000,
};

/**
 * og:title is a full sales listing, not a product name:
 * "Jual Helm Half Face COSMO | Black Dof Kaca Hitam | Paket Ganteng... "
 * Keep the leading "Jual <name>" chunk, drop the tail, drop the "Jual" verb.
 */
export function productName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = raw.replace(/^jual\s+/i, "").trim();
  s = s.split("|")[0].trim();
  s = s.replace(/[.,;:]+$/, "").trim();
  if (!s || s.length < 3) return null;
  // A name is not a sentence; overlong means the separator split failed.
  return s.length > 70 ? null : s;
}

/** Shop slugs read better than raw ids: "{{SHOP_SLUG}}" -> "Opaanlp". */
function shopLabel(link: LinkInfo): string {
  if (!link.shop) return "toko ini";
  const clean = link.shop.replace(/[._-]+/g, " ").trim();
  return clean.replace(/\b\w/g, (c) => c.toUpperCase());
}
void shopLabel; // kept only for reference; NEVER call it in a caption path

/** Product type -> generic Indonesian category word (helm/sepatu/...). Never a name. */
function detectCategoryWord(link: LinkInfo): string {
  const id = buildIdentity({
    product: link.product ?? null,
    kategori: link.kategori ?? null,
    shop: null,
  });
  return CATEGORY_WORD[detectType(id)] ?? "barang ini";
}

function buildBody(platform: Draft["platform"], link: LinkInfo, linkUrl: string): Draft {
  const notes: string[] = [];
  let body: string;

  const bio = "Link & detail lengkap ada di bio.";

  // No brand, no shop slug, no product name, no shipping claims: the same
  // spill rules as the mystery track. Direct differs only by tone: it talks
  // about the generic CATEGORY (helm/sepatu/...), never a merk or item name.
  const cat = detectCategoryWord(link);
  if (platform === "x") {
    body = `Setelah pakai ${cat}, baru paham kenapa orang repeats beli yang beginian.\n\nLink ada di bio.`;
    notes.push("X links no longer go inline: link placement is bio-only.");
  } else if (platform === "facebook") {
    body = [`Cerita singkat soal ${cat} yang satu ini.`, "", "Awalnya biasa aja, ternyata kepakai terus tiap hari dan harganya masuk kantong.", "", bio].join("\n");
    notes.push("Text-only post via FACEBOOK_CREATE_POST; add a product image URL before publishing.");
  } else {
    body = [`Jujur, ${cat} ini nggak pernah nyesel dipakai.`, "", "Yang suka: simpel, kepakai tiap hari, dan harganya masuk kantong.", "Yang kurang: pengiriman standar, jadi kalau buru-buru pilih yang lebih cepat.", "", bio, "", "#rekomendasi #belanjahemat #linkdiobio"].join("\n");
    notes.push("Instagram needs media: a single image_url is required; the link stays on the bio page only.");
  }

  if (body.length > CHAR_LIMIT[platform]) {
    body = body.slice(0, CHAR_LIMIT[platform] - 1);
    notes.push(`truncated to ${CHAR_LIMIT[platform]} chars for ${platform}`);
  }

  // Link placement is bio-only: no inline link, no first comment. Neither
  // Instagram nor Facebook exposes a "create comment" action in the toolkit,
  // and neither exposes a bio/profile write action either.
  const firstComment = null;
  if (firstComment) notes.push(`first comment link: ${firstComment}`);

  const mediaUrl = link.image_url ?? null;
  if (mediaUrl) notes.push(`media: ${mediaUrl}`);

  return {
    platform,
    kind: mediaUrl ? "image" : "text",
    body,
    linkPlacement: "bio",
    firstComment: null,
    media_url: mediaUrl,
    needsMedia: platform !== "x",
    notes,
  };
}

/**
 * Pure function so it can be tested without a network or the DB. The API layer
 * passes a stored link row; tests pass literals.
 */
export function buildTemplates(link: LinkInfo, linkUrl?: string, platforms?: Draft["platform"][]): Draft[] {
  const url = linkUrl || link.short_url;
  const targets = platforms ?? ["instagram", "facebook", "x"];
  return targets.map((p) => buildBody(p, link, url));
}
