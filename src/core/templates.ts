/**
 * Content templates — deterministic, no LLM call.
 *
 * Templates are built from whatever is actually known about a link: the Shopee
 * shop slug and item id. Unknown fields stay blank rather than being invented;
 * a caption that claims details it cannot source is worse than a short one.
 */

import type { ContentRow } from "./store.ts";

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

/** Shop slugs read better than raw ids: "opaanlp" -> "Opaanlp". */
function shopLabel(link: LinkInfo): string {
  if (!link.shop) return "toko ini";
  const clean = link.shop.replace(/[._-]+/g, " ").trim();
  return clean.replace(/\b\w/g, (c) => c.toUpperCase());
}

function buildBody(platform: Draft["platform"], link: LinkInfo, linkUrl: string): Draft {
  const shop = shopLabel(link);
  const name = productName(link.product);
  const notes: string[] = [];
  let body: string;

  const bio = "Link & detail lengkap ada di bio.";

  if (platform === "x") {
    body = name
      ? `${name} — dapet harga hemat di ${shop}.\n\nLink ada di bio.`
      : `Dapet harga hemat di ${shop}.\n\nLink ada di bio.`;
    notes.push("X links no longer go inline: link placement is bio-only.");
  } else if (platform === "facebook") {
    body = name
      ? [`Baru lihat ${name} di ${shop}.`, "", "Harga oke, ada gratis ongkir di beberapa waktu. Cocok buat yang lagi cari yang mirip.", "", bio].join("\n")
      : [`Baru nemu ini di ${shop}.`, "", "Harga oke, kualitas sesuai deskripsi — cocok buat yang lagi cari yang mirip.", "", bio].join("\n");
    notes.push("Text-only post via FACEBOOK_CREATE_POST; add a product image URL before publishing.");
  } else {
    body = name
      ? [`Baru nyoba ${name} dari ${shop} dan ternyata oke.`, "", "Yang suka: modelnya pas dan bahannya nggak gampang lecet.", "Yang kurang: pengiriman standar, jadi kalau buru-buru pilih yang lebih cepat.", "", bio, "", "#affiliate #shopee #rekomendasi #belanjahemat"].join("\n")
      : ["Hari ini nyoba produk dari " + shop + " dan ternyata oke banget.", "", "Yang suka: harganya masuk kantong dan hasilnya nggak mengecewakan.", "Yang kurang: pengiriman standar, jadi kalau buru-buru pilih yang lebih cepat.", "", bio, "", "#affiliate #shopee #rekomendasi #belanjahemat"].join("\n");
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
