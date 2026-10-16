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
  | "makanan"
  | "lain";

export function detectType(id: ProductIdentity): ProductType {
  const n = (id.name || "").toUpperCase();
  const k = (id.kategori || "").toUpperCase();
  const hay = n + " " + k;

  // ── LINGKUP 3 — FUNCTION FIRST ────────────────────────────────────────
  // The product's FUNCTION outranks the subject noun in its title. Shopee
  // titles read "<subject> <function>": "Shoes Dryer" is a DRYER (not
  // footwear), "Rak Sepatu" is a shelf (not footwear), "Kipas Angin" is a
  // fan. Without this block the subject noun wins and the hook/validator
  // end up educating about the wrong thing (proven live: content 191-193
  // shipped "mix-match outfit" copy for a shoe dryer).
  // ──────────────────────────────────────────────────────────────────────
  if (/RAK\s*SEPATU|SHOE\s*RACK|BOX\s*SEPATU|KOTAK\s*SEPATU|RACK\s*BUKU|PENGHARUM\s*SEPATU/.test(hay)) return "rumah";
  if (/PENGERING\s*(PAKAIAN|BAJU|SEPATU|RAMBUT|PIRING|GELAS|TANGAN|BOTOL)?\s*(PORTABLE|MINI|ELEKTRONIK|BAHAN)?|DRYER|DEHUMIDIFIER|HUMIDIFIER|DIFFUSER|STERILIZER|STEAMER|SETRIKA|\bIRON\b|VACUUM|PENGHISAP|AIR\s*FRYER|MESIN\s*CUCI|WASHER/.test(hay)) return "gadget";
  if (/COFFEE\s*(MAKER|GRINDER|BREWER|MACHINE)|GRINDER|GILINGAN|BLENDER|MIXER|JUICER|OVEN|MICROWAVE|PANCI|TEKO|KETTLE|RICE\s*COOKER|KOMPOR\s*LISTRIK|DISPENSER|AIR\s*MINERAL|LAMPU\s*UV|PEMANAS\s*(AIR|MINUM)|WATER\s*HEATER|PENGHANGAT/.test(hay)) return "rumah";
  if (/PROYEKTOR|PROJECTOR|SPEAKER|KIPAS|FAN|KAMERA|CAMERA|CCTV|PROYEK|MESIN\s*KASIR|BARCODE|SCANNER/.test(hay)) return "gadget";
  // appliances that TOUCH food are still appliances, not food: cold-brew
  // bottle, vacuum sealer, food chopper. (proven live: links 63/64)
  if (/BOTOL|BOTTLE|TUMBLER|VACUUM\s*SEALER|SEALER|CHOPPER|PENGOLAH|FOOD\s*PROCESSOR/.test(hay)) return "rumah";

  if (/HELM|KACAMATA|SUNGLASS|HEADGEAR/.test(hay)) return "helm";
  // ── LINGKUP 6 — MAKANAN FIRST ─────────────────────────────────────────
  // Food/snack keywords outrank gadget/rumah: "Coffee Maker" is an appliance
  // (matched above in LINGKUP 3), but "Coffee Candy", "Coklat", "Popcorn"
  // are food. This block sits AFTER the appliance block so machines stay
  // machines, but BEFORE everything else so snacks never fall to `lain`.
  // Proven live: link 8 (Dry Rub), 11 (Popcorn), 25 (Coklat Dubai) all
  // published with generic "barang" hooks.
  // ──────────────────────────────────────────────────────────────────────
  // NOTE: MIE matches instant noodles — but "Mie..." never starts an
  // appliance title, while BOTOL/SEALER titles do; those are caught above.
  if (/MAKANAN|FOOD(?!S?\s+(PROCESSOR|CHOPPER|CONTAINER|STORAGE))|SNACK|CAMILAN|JAJAN|KUE\b|COOKIE|KERIPIK|CHIPS|POPCORN|COKLAT|CHOCOLATE|PERMEN|CANDY|BUMBU|MARINASI|DRY\s*RUB|SAUS\b|SAUCE|SAMBAL|KECAP|MIE\b|MIE\s|NOODLE|KOPI\b(?!.*(GRINDER|MAKER|ELEKTRIK))|COFFEE\s*(CANDY|BEAN|SNACK)|SUSU\b|MILK|TEH\b|TEA\s*(CELUP|BOTOL)|MINUMAN|BAVERAGE|ROTI|CAKE|BISKUIT|CUPCAKE|CILOK|BASO\s*ACI|SEBLAK|DIMSUM|FROZEN\s*FOOD|DUBAI\s*(CHOCO|COKLAT)|KHUNAFA|KUNAFA|PISTACHIO/.test(hay)) return "makanan";
  if (/SEPATU|SANDAL|SHOES|SNEAKERS|SLIPON/.test(hay)) return "sepatu";
  // ORDER MATTERS + WORD BOUNDARIES: "SERBAGUNA" contains "BAG", "KERTAS"
  // contains "TAS" — bare substrings turn a folding chair into a bag.
  // A folding chair is only OUTDOOR gear when the title says so; "Kursi Lipat
  // Lesehan Sofa Lantai" is living-room furniture (proven live: content
  // 296-298 shipped a camping/cold-mountain hook for a floor chair).
  if (/KURSI\s*LIPAT|FOLDING\s*CHAIR/.test(hay)) {
    return /CAMPING|GUNUNG|OUTDOOR|TENDA|HIKING|PICNIC|TRAVEL|MENDALI|PANCING|FISHING/.test(hay) ? "outdoor" : "rumah";
  }
  if (/\bTAS\b|BACKPACK|RANSEL|SELEMPANG|\bBAGS?\b|DOMPET|WALLET/.test(hay)) return "tas";
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
    makanan: "camilan",
    lain: "barang",
  };
  return m[t] || "barang";
}
