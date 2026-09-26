/**
 * Bio-link bridge — the karasu-michi bio page is a SPA that reads its product
 * list from a Google Apps Script endpoint, which in turn reads the `items` tab
 * of a Google Sheet. So "upload to the bio link" is exactly two operations:
 *
 *   1. read  GET  <APPS_SCRIPT_URL>              -> live list (what visitors see)
 *   2. write GOOGLESHEETS_BATCH_UPDATE           -> append a row to `items`
 *
 * The row schema is fixed by the sheet header (A..G):
 *   id | nomor_urut | title | deskripsi | link | kategori | images
 *
 * `images` holds a URL string in the sheet, but the Apps Script emits an array
 * of one URL, and only the first image is rendered. That as only the first
 * image is pushed.
 */

import { composio } from "./composio.ts";

export const SPREADSHEET_ID = "1WYszJm_CE8yQumIWNG_Db_KyAVxFFnU8kb2hw90SN0c";
export const SHEET_TAB = "items";
export const APPS_SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbzzbhZXRujhmhyPu7JtJtDGEcgcefqA2TZFRj1xcsWH2zdTAm6jxCku6CIhbPq3gClY/exec";

export const BIO_PAGE_URL = "https://karasu-michi.vercel.app";

/** The exact column order of the `items` tab. Never reorder. */
export const ITEM_COLUMNS = ["id", "nomor_urut", "title", "deskripsi", "link", "kategori", "images"] as const;

export type BioItem = {
  id: number;
  nomor_urut: number;
  title: string;
  deskripsi: string;
  link: string;
  kategori: string;
  images: string[];
};

/** Shape used to build a new row. `images` may hold 0..n urls; the first wins. */
export type BioItemInput = {
  title: string;
  deskripsi: string;
  link: string;
  kategori: string;
  images?: string[];
};

const FETCH_TIMEOUT_MS = 30_000;

/** Read the live list the bio page actually renders. */
export async function fetchBioItems(): Promise<BioItem[]> {
  const res = await fetch(APPS_SCRIPT_URL, {
    headers: { "user-agent": "Mozilla/5.0 (compatible; karasu-michi-biolink/1.0)" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`bio endpoint HTTP ${res.status}`);
  const data = (await res.json()) as unknown;
  if (!Array.isArray(data)) throw new Error("bio endpoint did not return an array");
  return data as BioItem[];
}

/** The next free ids: both `id` and `nomor_urut` track row order in the sheet. */
export function nextIds(items: BioItem[]): { id: number; nomor_urut: number } {
  const maxId = items.reduce((m, i) => Math.max(m, Number(i.id) || 0), 0);
  return { id: maxId + 1, nomor_urut: maxId + 1 };
}

/**
 * A Shopee short link, i.e. something the system can actually enrich, generate
 * content for and publish. This is what separates a real product row from a
 * test row: the test rows in this sheet carry an image URL in the `link`
 * column.
 */
export function isShopeeShortLink(link: string): boolean {
  return /^https:\/\/s\.shopee\.co\.id\/[A-Za-z0-9_-]{6,}$/.test((link || "").trim());
}

/**
 * The identity of one product row.
 *
 * The sheet's `id` column is the row's natural key and is unique — it is the
 * value `nextIds` hands out when appending. The short link is NOT a key: two
 * rows in this sheet carry the same short link for different products, so
 * keying on the link silently drops one product and blocks it from ever being
 * re-published. Rows without a usable id fall back to link+title.
 */
export function bioRowKey(item: Pick<BioItem, "id" | "link" | "title">): string {
  const id = Number(item.id);
  if (Number.isFinite(id) && id > 0) return `#${id}`;
  return `${(item.link || "").trim()}|${(item.title || "").trim()}`;
}

/** True when this product row is already on the bio page. */
export function isOnBio(items: BioItem[], rowKey: string, link: string): boolean {
  const needle = (link || "").trim().replace(/\/$/, "");
  return items.some(
    (i) => bioRowKey(i) === rowKey || (needle !== "" && (i.link || "").trim().replace(/\/$/, "") === needle),
  );
}

/** Product rows worth importing, de-duplicated by row key. */
export function importableItems(items: BioItem[]): BioItem[] {
  const out: BioItem[] = [];
  const seen = new Set<string>();
  for (const i of items) {
    if (!isShopeeShortLink(i.link)) continue;
    const key = bioRowKey(i);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(i);
  }
  return out;
}

/** Build one sheet row in the exact A..G order. */
export function toRow(item: BioItemInput, id: number, nomorUrut: number): string[] {
  const images = (item.images ?? []).filter((u) => /^https?:\/\//i.test(u));
  return [
    String(id),
    String(nomorUrut),
    item.title,
    item.deskripsi,
    item.link,
    item.kategori,
    images[0] ?? "",
  ];
}

/**
 * Append one row to the `items` tab.
 *
 * Verified against the live tool schema at
 * ~/.composio/tool_definitions/GOOGLESHEETS_SPREADSHEETS_VALUES_APPEND.json:
 * required keys are spreadsheetId / range / valueInputOption / values, and
 * `range` must be sheet-qualified. GOOGLESHEETS_BATCH_UPDATE also works but is
 * marked deprecated and its response shape differs, so this is the stable path.
 *
 * The Sheet API may land the row in different columns than requested (table
 * detection), so the response's updatedRange is checked against the expected
 * row index when it is supplied.
 */
export async function appendBioItem(row: string[], expectRow?: number): Promise<{ updatedRange: string | null }> {
  if (row.length !== ITEM_COLUMNS.length) {
    throw new Error(`row must have ${ITEM_COLUMNS.length} cells, got ${row.length}`);
  }
  const range = `${SHEET_TAB}!A:${"ABCDEFGHIJKLMNOPQRSTUVWXYZ"[ITEM_COLUMNS.length - 1]}`;
  const res = await composio.execute("GOOGLESHEETS_SPREADSHEETS_VALUES_APPEND", {
    spreadsheetId: SPREADSHEET_ID,
    range,
    values: [row],
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    includeValuesInResponse: true,
  });
  if (!res.ok) throw new Error(`sheet append failed: ${res.error}`);

  const updatedRange = res.data?.updates?.updatedRange ?? null;
  if (updatedRange && expectRow) {
    const hit = new RegExp(`([A-Z]+)${expectRow}(?::|$)`).exec(updatedRange);
    if (!hit) {
      throw new Error(`row landed at ${updatedRange}, expected row ${expectRow}`);
    }
  }
  return { updatedRange };
}

/**
 * Delete one row by its sheet position. Used to clean up a mis-appended row.
 * Zero-based, inclusive start / exclusive end — row 16 is start 15, end 16.
 */
export async function deleteBioRow(rowNumber: number): Promise<void> {
  const startIndex = rowNumber - 1;
  // GOOGLESHEETS_DELETE_DIMENSION is snake_case at the top level
  // (`spreadsheet_id`), unlike VALUES_APPEND which is camelCase. Do not add
  // `sheet_id`: in this schema that field is the numeric grid-sheet id, and a
  // spreadsheet id there fails type validation. Flat snake_case works.
  const res = await composio.execute("GOOGLESHEETS_DELETE_DIMENSION", {
    spreadsheet_id: SPREADSHEET_ID,
    sheet_name: SHEET_TAB,
    dimension: "ROWS",
    start_index: startIndex,
    end_index: startIndex + 1,
  });
  if (!res.ok) throw new Error(`row delete failed: ${res.error}`);
}

/**
 * Claim a product onto the bio page:
 *   - skip when already present (idempotent)
 *   - skip when no image (the page renders images; a link-only row looks broken)
 *   - otherwise append and re-read to confirm the new row is live
 */
export async function publishToBio(input: BioItemInput): Promise<
  | { status: "already" }
  | { status: "skipped"; reason: string }
  | { status: "written"; id: number; range: string | null; confirmed: boolean }
> {
  const images = (input.images ?? []).filter((u) => /^https?:\/\//i.test(u));
  if (images.length === 0) return { status: "skipped", reason: "no usable image url" };

  const before = await fetchBioItems();
  // A new row has no sheet id yet. Pass a non-positive id so bioRowKey takes
  // its `link|title` fallback branch — referencing the `id` that nextIds hands
  // out below would be a temporal-dead-zone ReferenceError.
  const rowKey = bioRowKey({ id: 0, link: input.link, title: input.title });
  if (isOnBio(before, rowKey, input.link)) return { status: "already" };

  const { id, nomor_urut } = nextIds(before);
  const expectRow = id + 1; // sheet has a header row: data row N sits at row N+1
  const { updatedRange } = await appendBioItem(toRow(input, id, nomor_urut), expectRow);

  let confirmed = false;
  try {
    const after = await fetchBioItems();
    confirmed = after.some((i) => Number(i.id) === id && (i.link || "") === input.link);
  } catch {
    confirmed = false;
  }
  return { status: "written", id, range: updatedRange, confirmed };
}
