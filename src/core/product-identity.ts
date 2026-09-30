/**
 * Product identity — what we actually know about a link.
 *
 * The source of truth is the `links` row populated by the Shopee scraper
 * (src/core/shopee.ts).  Fields used here:
 *
 *   product   — og:title stripped of "Jual " and tail after "|"
 *   kategori  — operator-supplied category (may be null)
 *   shop      — Shopee shop slug
 *
 * All three are *evidence*, not guesses.  If `product` is null, we fall back
 * to the `kategori` clue; if that is also null, the generic "barang" floor is
 * used and a constraint is recorded so the operator knows to fill it in.
 */

export type ProductIdentity = {
  /** Cleaned product name, e.g. "Helm Half Face COSMO" */
  name: string | null;
  /** Operator-supplied category, e.g. "HELM" */
  kategori: string | null;
  /** Shop slug, e.g. "{{SHOP_SLUG}}" */
  shop: string;
  /** Full og:title as scraped (for hook generation) */
  rawTitle: string | null;
};

export function buildIdentity(link: {
  product: string | null;
  kategori: string | null;
  shop: string | null;
}): ProductIdentity {
  return {
    name: link.product?.trim() || null,
    kategori: link.kategori?.trim() || null,
    shop: link.shop || "toko ini",
    rawTitle: link.product,
  };
}

/** Product type from name + kategori — drives hook and visual prompt. */
export type ProductType =
  | "helm"
  | "sepatu"
  | "tas"
  | "gadget"
  | "skincare"
  | "outdoor"
  | "mainan"
  | "olahraga"
  | "rumah"
  | "fashion"
  | "lain";

export function detectType(id: ProductIdentity): ProductType {
  const n = (id.name || "").toUpperCase();
  const k = (id.kategori || "").toUpperCase();
  const hay = n + " " + k;

  if (/HELM|KACAMATA|SUNGLASS|HEADGEAR/.test(hay)) return "helm";
  if (/SEPATU|SANDAL|SHOES|SNEAKERS|SLIPON/.test(hay)) return "sepatu";
  if (/TAS|BACKPACK|RANSEL|BAG|DOMPET|WALLET/.test(hay)) return "tas";
  if (/GADGET|ELEKTRONIK|HP|PHONE|CHARGER|EARPHONE|SPEAKER|HEADPHONE|MOUSE|KEYBOARD|KABEL/.test(hay)) return "gadget";
  if (/SKINCARE|BEAUTY|MAKEUP|SERUM|MOISTURIZER|TONER|SABUN|BEDAK|LIPSTIK|PARFUM/.test(hay)) return "skincare";
  if (/OUTDOOR|CAMPING|HIKING|TENDA|SLEEPING BAG|MATRAS|LAMPU|KOBOKAYU/.test(hay)) return "outdoor";
  if (/MAINAN|TOY|ANAK|BONEKA|LEGO|PUZZLE/.test(hay)) return "mainan";
  if (/FASHION|FASHY|PAKAIAN|BAJU|KAOS|KEMEJA|DRESS|HOODIE|JAKET|CELANA|SHIRT|JEANS|KARDIGAN/.test(hay)) return "fashion";
  if (/\b(HEALTH|SPORT|FITNESS|OLAHRAGA|BOLA|RAKET|DUMBBELL|YOGA|GYM|SEPEDA)\b/.test(hay)) return "olahraga";
  if (/RUMAH|HOME|DEKOR|LAMPU|KASUR|BANTAL|KIPAS|PANCI|DAPUR/.test(hay)) return "rumah";
  return "lain";
}

/** Human label for the type (Indonesian). */
export function typeLabel(t: ProductType): string {
  const m: Record<ProductType, string> = {
    helm: "helm",
    sepatu: "sepatu",
    tas: "tas",
    gadget: "gadget",
    skincare: "skincare",
    outdoor: "gear outdoor",
    mainan: "mainan",
    olahraga: "gear olahraga",
    rumah: "barang rumah",
    fashion: "outfit",
    lain: "barang",
  };
  return m[t] || "barang";
}
