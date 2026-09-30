/**
 * The add-link pipeline — the primary input path.
 *
 * The web app sends one or many Shopee short links. For each link the system
 * does the work the operator used to do by hand:
 *
 *   1. normalise the link (Shopee only — a link we cannot enrich is refused)
 *   2. resolve it to the canonical product URL and pull og:title / og:image
 *   3. verify the image is actually fetchable (Meta must be able to fetch it)
 *   4. store the row in SQLite (idempotent — re-adding a link updates, never duplicates)
 *   5. append the product to the bio Google Sheet so the bio page shows it
 *
 * Steps 2-3 are the "auto data lookup". They are best-effort: a link that
 * cannot be enriched is still stored (the operator can enrich later), but it is
 * NOT appended to the sheet, because a link-only row renders broken on the bio
 * page — the page renders images.
 *
 * Sheet appends are deliberately sequential. `nextIds` computes max(id)+1 from
 * the live sheet, so two appends in the same bulk call would both read the same
 * max and claim the same id. One append at a time, re-reading between each, is
 * the only correct order.
 */

import { addLink, enrichLink, getLinkByUrl, attachSheetId } from "./store.ts";
import { fetchOg, checkImageUrl } from "./shopee.ts";
import { classifyCategory } from "./category.ts";
import { productName } from "./templates.ts";
import { fetchBioItems, isShopeeShortLink, publishToBio } from "./biolink.ts";

export type AddLinkInput = {
  /** The Shopee short link, e.g. https://s.shopee.co.id/7fWhVsLimR */
  short_url: string;
  /** Optional copy the operator typed; falls back to the sheet/product title. */
  deskripsi?: string;
  /** Optional category; defaults to "UNCATEGORIZED" when unknown. */
  kategori?: string;
  /** Set false to skip the Google Sheet append for this link. */
  toSheet?: boolean;
};

export type AddLinkResult = {
  short_url: string;
  status: "added" | "updated" | "rejected";
  reason?: string;
  link_id?: number;
  product?: string | null;
  image_url?: string | null;
  deskripsi?: string | null;
  image_verified: boolean;
  og_found: boolean;
  kategori?: string | null;
  kategori_source?: "operator" | "auto" | "stored" | null;
  sheet?: "written" | "already" | "skipped";
  sheet_id?: number;
};

export type BulkAddResult = {
  total: number;
  added: number;
  updated: number;
  rejected: number;
  results: AddLinkResult[];
};

const DEFAULT_KATEGORI = "UNCATEGORIZED";
const OG_TIMEOUT_MS = Number(process.env.AFFILIATE_OG_TIMEOUT_MS || 25_000);

/** A canonical short link, or an explanation of why it is not acceptable. */
export function normaliseLink(raw: string): { ok: true; url: string } | { ok: false; reason: string } {
  const link = (raw || "").trim();
  if (!link) return { ok: false, reason: "empty" };
  if (!/^https?:\/\//i.test(link)) {
    return { ok: false, reason: "must be an http(s) URL" };
  }
  // Shopee only: the whole pipeline (og scraping, product naming, image probe,
  // bio page rendering) is built around Shopee's markup.
  if (!/shopee\.(co\.id|id|com)/i.test(link)) {
    return { ok: false, reason: "not a Shopee link" };
  }
  if (!isShopeeShortLink(link)) {
    // Accept full product URLs too; the og fetch works on both.
    if (/shopee\.(co\.id|id|com)\/.*\d{5,}.*\d{5,}/i.test(link)) return { ok: true, url: link };
    return { ok: false, reason: "not a recognisable Shopee product link" };
  }
  return { ok: true, url: link };
}

/**
 * The full pipeline for one link.
 *
 * `dryRun` stops after the og fetch so the UI can preview what a bulk add would
 * do before committing rows to the sheet.
 */
export async function addLinkPipeline(
  input: AddLinkInput,
  opts: { dryRun?: boolean } = {},
): Promise<AddLinkResult> {
  const base: AddLinkResult = {
    short_url: input.short_url,
    status: "rejected",
    image_verified: false,
    og_found: false,
  };

  const norm = normaliseLink(input.short_url);
  if (!norm.ok) return { ...base, reason: norm.reason };

  const existing = getLinkByUrl(norm.url);
  const toSheet = input.toSheet !== false;

  // --- auto data lookup ---
  let og: Awaited<ReturnType<typeof fetchOg>> | null = null;
  let imageVerified = false;
  try {
    og = await fetchOg(norm.url, OG_TIMEOUT_MS);
  } catch (e) {
    og = null;
  }
  const ogFound = !!(og?.title || og?.image);
  if (og?.image) {
    const probe = await checkImageUrl(og.image);
    imageVerified = probe.ok;
  }

  const product = og?.title ? productName(og.title) : (existing?.product ?? null);
  const image_url = (imageVerified ? og?.image : null) ?? existing?.image_url ?? null;
  const deskripsi = og?.description || (existing as { deskripsi?: string | null })?.deskripsi || null;

  // --- category: operator wins, else auto-guess from title+description ---
  let kategori: string | null = input.kategori?.trim() || null;
  let kategori_source: AddLinkResult["kategori_source"] = kategori ? "operator" : null;
  if (!kategori) {
    const stored = existing?.kategori?.trim() || null;
    if (stored && stored !== DEFAULT_KATEGORI) {
      kategori = stored;
      kategori_source = "stored";
    } else if (product || og?.description) {
      const guess = await classifyCategory(product || og?.title || "", og?.description || "");
      kategori = guess.category;
      kategori_source = "auto";
    }
  }

  if (opts.dryRun) {
    return {
      ...base,
      status: "added",
      link_id: existing?.id,
      product,
      image_url,
      deskripsi,
      image_verified: imageVerified,
      og_found: ogFound,
      kategori,
      kategori_source,
      sheet: undefined,
    };
  }

  // --- store ---
  const inserted = addLink({
    short_url: norm.url,
    product,
    image_url,
    deskripsi,
    kategori: kategori || existing?.kategori || null,
  });
  // addLink is idempotent on short_url — a re-add returns the stale row as-is,
  // so backfill columns the first save missed (deskripsi/kategori are new;
  // older rows predate them) before anything downstream reads the row.
  let row = inserted;
  if (existing && (product || image_url || deskripsi || kategori)) {
    enrichLink(inserted.id, { product, image_url, deskripsi, kategori: kategori || existing.kategori });
    row = { ...inserted, product: product ?? inserted.product, image_url: image_url ?? inserted.image_url, deskripsi: deskripsi ?? inserted.deskripsi, kategori: kategori || inserted.kategori };
  }
  // Distinguish a genuine insert from an idempotent re-add: addLink returns the
  // existing row unchanged when the short_url is already stored, so a row that
  // already had data is an "updated", a fresh row is an "added".
  const hadData = !!existing?.product || !!existing?.image_url;
  const status: AddLinkResult["status"] = existing && hadData ? "updated" : "added";

  // A row with no image cannot go on the bio page — it would render broken.
  if (!toSheet) {
    return {
      ...base,
      status,
      link_id: row.id,
      product: row.product,
      image_url: row.image_url,
      deskripsi,
      image_verified: imageVerified,
      og_found: ogFound,
      kategori,
      kategori_source,
      sheet: "skipped",
    };
  }
  if (!image_url) {
    return {
      ...base,
      status,
      link_id: row.id,
      product: row.product,
      image_url: row.image_url,
      deskripsi,
      image_verified: imageVerified,
      og_found: ogFound,
      kategori,
      kategori_source,
      sheet: "skipped",
      reason: "no fetchable image — not appended to sheet",
    };
  }

  // --- append to the bio sheet (sequential; see the module note) ---
  let sheet: AddLinkResult["sheet"];
  let sheetId: number | undefined;
  try {
    const res = await publishToBio({
      title: row.product || product || "Produk",
      deskripsi: input.deskripsi ?? deskripsi ?? "",
      link: row.short_url,
      kategori: kategori || row.kategori || DEFAULT_KATEGORI,
      images: [image_url],
    });
    sheet = res.status === "written" ? "written" : res.status;
    if (res.status === "written") sheetId = res.id;
  } catch (e) {
    sheet = "skipped";
    return {
      ...base,
      status,
      link_id: row.id,
      product: row.product,
      image_url: row.image_url,
      deskripsi,
      image_verified: imageVerified,
      og_found: ogFound,
      kategori,
      kategori_source,
      sheet,
      reason: `sheet append failed: ${String(e).slice(0, 200)}`,
    };
  }

  // Bind the sheet row to the stored link so future imports re-read it as the
  // same product instead of creating a duplicate.
  if (sheetId != null) {
    const items = await fetchBioItems().catch(() => [] as Awaited<ReturnType<typeof fetchBioItems>>);
    const match = items.find((i) => Number(i.id) === sheetId);
    if (match) {
      // Attach the sheet id to the SAME row that is already in the DB.
      // Inserting a second row here would leave an unbound orphan and make
      // one link show up twice — plus it can steal a sheet_id that already
      // belongs to another link.
      attachSheetId(row.id, sheetId);
    }
  }

  return {
    ...base,
    status,
    link_id: row.id,
    product: row.product,
    image_url: row.image_url,
    deskripsi,
    image_verified: imageVerified,
    og_found: ogFound,
    kategori,
    kategori_source,
    sheet,
    sheet_id: sheetId,
  };
}

/** Bulk entry point. Links are processed strictly one after another. */
export async function addLinksBulk(
  inputs: AddLinkInput[],
  opts: { dryRun?: boolean } = {},
): Promise<BulkAddResult> {
  const results: AddLinkResult[] = [];
  for (const input of inputs) {
    results.push(await addLinkPipeline(input, opts));
  }
  return {
    total: inputs.length,
    added: results.filter((r) => r.status === "added").length,
    updated: results.filter((r) => r.status === "updated").length,
    rejected: results.filter((r) => r.status === "rejected").length,
    results,
  };
}

/** Split a textarea blob (one link per line, commas tolerated) into inputs. */
export function parseLinkBlob(blob: string): AddLinkInput[] {
  return blob
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((short_url) => ({ short_url }));
}
