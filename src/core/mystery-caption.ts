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

export type MysteryDraft = {
  platform: "instagram" | "facebook" | "x";
  body: string;
  bio_line: string;
  constraints: string[];
};

export const BIO_LINE = "Link & detail lengkap ada di bio.";

/** Category keywords -> a readable Indonesian noun used as the clue. */
const CATEGORY_WORDS: Array<[RegExp, string]> = [
  [/FASHY|BAJU|PAKAIAN|KAOS|KEMEJA|DRESS|HOODIE/, "outfit"],
  [/SEPATU|SANDAL|SHOES/, "sepatu"],
  [/TAS|BAG/, "tas"],
  [/GADGET|ELEKTRONIK|HP|PHONE|CHARGER|EARPHONE|SPEAKER/, "gadget"],
  [/KECANTIKAN|SKINCARE|BEAUTY|MAKEUP|SERUM/, "skincare"],
  [/MASAK|DAPUR|KITCHEN/, "alat dapur"],
  [/OUTDOOR|CAMPING|HIKING/, "gear outdoor"],
  [/MAINAN|TOY|ANAK/, "mainan"],
  [/HR|HEALTH|SPORT|FITNESS|OLAHRAGA/, "gear olahraga"],
  [/RUMAH|HOME|DEKOR/, "barang rumah"],
];

/** The only clue a caption is allowed to leak. */
export function categoryClue(kategori: string | null | undefined): string {
  const k = (kategori || "").toUpperCase();
  for (const [re, word] of CATEGORY_WORDS) if (re.test(k)) return word;
  return "barang";
}

/** Shop slug -> readable label. Same rule as templates.ts. */
function shopLabel(link: LinkInfo): string {
  if (!link.shop) return "toko ini";
  const clean = link.shop.replace(/[._-]+/g, " ").trim();
  return clean.replace(/\b\w/g, (c) => c.toUpperCase());
}

const CHAR_LIMIT: Record<MysteryDraft["platform"], number> = {
  x: 280,
  instagram: 2200,
  facebook: 60000,
};

function igMystery(shop: string, clue: string): string {
  return [
    `Nggak aku sebut namanya, kalau penasaran cek di bio.`,
    ``,
    `Baru lewat satu ${clue} di ${shop} yang desainnya bikin berhenti scroll. Tipe yang dilihat sekali, kepikir lagi besoknya.`,
    ``,
    `Yang bikin menarik: bentuk dan warnanya beda dari yang biasa beredar. Detail pas di foto.`,
    ``,
    `Kira-kira buat apa ya barang ini? Tebak di komentar, aku bales yang paling dekat.`,
    ``,
    `Biar nggak salah harga, langsung cek link di bio sebelum kepencar.`,
    ``,
    BIO_LINE,
    ``,
    `#rekomendasi #shopee #belanjahemat #fyp #affiliate`,
  ]
    .join("\n")
    .replace(/{{shop}}/g, shop)
    .replace(/{{clue}}/g, clue);
}

function fbMystery(shop: string, clue: string): string {
  return [
    `Ada satu ${clue} di ${shop} yang sampai sekarang masih ada di pikiran saya.`,
    ``,
    `Saya nggak sebut namanya di sini — bukan rahasia sih, tapi kalau langsung disebut, kesannya seperti promosi biasa. Padahal serunya justru di bentuknya, yang jarang ketemu di toko yang sama.`,
    ``,
    `Kalau kamu orangnya suka yang sedikit beda dari yang lain, ini layak dilihat. Kalau cari yang paling umum, lewati saja.`,
    ``,
    `Harga dan detailnya ada di link di bio, jadi nggak perlu tanya-tanya di komen.`,
    ``,
    `Tahu nggak barang apa itu? Drop tebakan kalian.`,
  ]
    .join("\n")
    .replace(/{{shop}}/g, shop)
    .replace(/{{clue}}/g, clue);
}

function threadsMystery(shop: string, clue: string): string {
  return `Satu ${clue} di ${shop} bikin berhenti scroll. Namanya aku sembunyikan dulu — penasaran, link di bio.`;
}

export function buildMysteryCaption(platform: MysteryDraft["platform"], link: LinkInfo): MysteryDraft {
  const shop = shopLabel(link);
  const clue = categoryClue(link.kategori);
  const constraints: string[] = [];

  let body =
    platform === "instagram"
      ? igMystery(shop, clue)
      : platform === "facebook"
        ? fbMystery(shop, clue)
        : threadsMystery(shop, clue);

  if (body.length > CHAR_LIMIT[platform]) {
    body = body.slice(0, CHAR_LIMIT[platform] - 1);
    constraints.push(`truncated to ${CHAR_LIMIT[platform]} chars`);
  }

  // Hard invariant: the real product name must be gone from the caption.
  if (/\{\{|\}\}/.test(body)) constraints.push("unresolved placeholder — check categoryClue/shopLabel input");

  return { platform, body, bio_line: BIO_LINE, constraints };
}

/** Which platforms the mystery builder currently covers. */
export const MYSTERY_PLATFORMS: MysteryDraft["platform"][] = ["instagram", "facebook", "x"];

/** Kind, kept aligned with the ContentRow shape so drafts stay storable. */
export function mysteryKind(mediaUrl: string | null | undefined): ContentRow["kind"] {
  return mediaUrl ? "image" : "text";
}
