/**
 * Content store — node:sqlite, zero dependencies.
 *
 * Holds affiliate links and the generated content drafts that reference them.
 * No credentials are ever stored here: only URLs, captions, and local row ids.
 */

import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.AFFILIATE_DB || join(HERE, "..", "..", "data", "affiliate.db");

export type LinkRow = {
  id: number;
  short_url: string;
  resolved_url: string | null;
  shopee_shop_id: string | null;
  shopee_item_id: string | null;
  shop: string | null;
  product: string | null;
  image_url: string | null;
  /** The untouched Shopee og:image — img2img reference + mismatch audit. */
  image_original: string | null;
  deskripsi: string | null;
  kategori: string | null;
  sheet_id: number | null;
  note: string | null;
  created_at: string;
  published_count?: number;
  last_published_at?: string | null;
  published_url?: string | null;
  published_at?: string | null;
  is_published?: string | null;
  /** link-health probe result: 'alive' | 'dead' | null (never checked). */
  link_health?: string | null;
  link_checked_at?: string | null;
  link_dead_streak?: number | null;
};

export type ContentRow = {
  id: number;
  link_id: number;
  platform: string;
  kind: "text" | "image" | "video" | "carousel";
  body: string;
  media_url: string | null;
  /** Instagram-family posts keep the affiliate link out of the caption; store it here. */
  first_comment: string | null;
  status: "draft" | "approved" | "published" | "rejected";
  post_id: string | null;
  post_url: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
};

// node:sqlite will not create missing parent directories, so make them first.
mkdirSync(dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS links (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    shop            TEXT,
    short_url       TEXT NOT NULL,
    resolved_url    TEXT,
    shopee_shop_id  TEXT,
    shopee_item_id  TEXT,
    product         TEXT,
    image_url       TEXT,
    image_original  TEXT,
    deskripsi       TEXT,
    kategori        TEXT,
    sheet_id        INTEGER UNIQUE,
    note            TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    published_count INTEGER NOT NULL DEFAULT 0,
    last_published_at TEXT
  );
  CREATE TABLE IF NOT EXISTS content (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    link_id      INTEGER NOT NULL REFERENCES links(id) ON DELETE CASCADE,
    platform     TEXT NOT NULL,
    kind         TEXT NOT NULL DEFAULT 'text',
    body         TEXT NOT NULL,
    media_url    TEXT,
    status       TEXT NOT NULL DEFAULT 'draft',
    post_id      TEXT,
    post_url     TEXT,
    error        TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_content_link ON content(link_id);
  CREATE TABLE IF NOT EXISTS thread_replies (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    content_id   INTEGER NOT NULL REFERENCES content(id) ON DELETE CASCADE,
    comment_id   TEXT NOT NULL UNIQUE,
    comment_user TEXT,
    comment_text TEXT,
    reply_text   TEXT NOT NULL,
    reply_id     TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_replies_content ON thread_replies(content_id);
`);
// Migration for a database created before first_comment existed.
const cols = db.prepare(`PRAGMA table_info(content)`).all() as unknown as Array<{ name: string }>;
if (!cols.some((c) => c.name === "first_comment")) {
  db.exec(`ALTER TABLE content ADD COLUMN first_comment TEXT`);
}
// Migration for a database created before product enrichment existed.
const linkCols = db.prepare(`PRAGMA table_info(links)`).all() as unknown as Array<{ name: string }>;
for (const [col, ddl] of [["product", "TEXT"], ["image_url", "TEXT"], ["image_original", "TEXT"], ["deskripsi", "TEXT"], ["kategori", "TEXT"], ["sheet_id", "INTEGER"], ["published_count", "INTEGER DEFAULT 0"], ["last_published_at", "TEXT"], ["link_health", "TEXT"], ["link_checked_at", "TEXT"], ["link_dead_streak", "INTEGER DEFAULT 0"]] as const) {
  if (!linkCols.some((c) => c.name === col)) {
    db.exec(`ALTER TABLE links ADD COLUMN ${col} ${ddl}`);
  }
}
// `ON CONFLICT(sheet_id)` needs a real UNIQUE index, not just the column. A
// table born fresh carries it in the CREATE TABLE; one migrated by ALTER does
// not, so create the index here — without it the upsert throws at runtime and
// the importer dies on the first row.
{
  const idx = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='links' AND sql LIKE '%sheet_id%'`)
    .all() as Array<{ name: string }>;
  if (idx.length === 0) {
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS links_sheet_id ON links(sheet_id)`);
  }
  // A database born before `sheet_id` existed carries `short_url TEXT NOT NULL
  // UNIQUE` in its live table. Re-running the schema above does not rewrite it,
  // so the unique constraint survives and every duplicate short link collides.
  // Two rows in the sheet legitimately share a short link for different products,
  // so the table must be rebuilt without it — the sheet row id is the key, not
  // the link. `sqlite_autoindex_links_1` is the constraint's implicit index and
  // cannot be dropped on its own.
  {
    const ddl = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='links'`).get() as unknown as { sql: string };
    if (ddl && /short_url\s+TEXT\s+NOT\s+NULL\s+UNIQUE/i.test(ddl.sql)) {
      db.exec(`PRAGMA foreign_keys = OFF`);
      db.exec(`BEGIN`);
      db.exec(`
        CREATE TABLE links_migrating (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          shop            TEXT,
          short_url       TEXT NOT NULL,
          resolved_url    TEXT,
          shopee_shop_id  TEXT,
          shopee_item_id  TEXT,
          product         TEXT,
          image_url       TEXT,
          kategori        TEXT,
          sheet_id        INTEGER UNIQUE,
          note            TEXT,
          created_at      TEXT NOT NULL DEFAULT (datetime('now'))
        );
        INSERT INTO links_migrating (id, shop, short_url, resolved_url, shopee_shop_id, shopee_item_id, product, image_url, kategori, sheet_id, note, created_at)
          SELECT id, shop, short_url, resolved_url, shopee_shop_id, shopee_item_id, product, image_url, kategori, sheet_id, note, created_at FROM links;
        DROP TABLE links;
        ALTER TABLE links_migrating RENAME TO links;
        CREATE UNIQUE INDEX IF NOT EXISTS links_sheet_id ON links(sheet_id);
      `);
      db.exec(`COMMIT`);
      db.exec(`PRAGMA foreign_keys = ON`);
    }
  }
}


/** Shopee ids travel in the path as /<shop-slug>/<shopId>/<itemId>. */
export function parseShopee(url: string): { shopId: string | null; itemId: string | null; shop: string | null } {
  let shopId: string | null = null;
  let itemId: string | null = null;
  for (const m of url.matchAll(/\/(\d{5,})\/(\d{5,})/g)) {
    shopId = m[1];
    itemId = m[2];
  }
  const slug = url.match(/shopee\.co\.id\/([a-z0-9._-]+)/i);
  return { shopId, itemId, shop: slug ? slug[1] : null };
}

/**
 * Point an existing, unbound link at a sheet row.
 *
 * A link added from the web app is stored without a sheet_id and only gets one
 * when it is appended. Binding must move that SAME row — inserting a second
 * one for the same short_url leaves an orphan that no longer matches the
 * sheet (and makes the link appear twice).
 *
 * Returns null when the sheet_id is already owned by a different row: that is
 * exactly the case where an update would overwrite somebody else's link.
 */
export function attachSheetId(linkId: number, sheetId: number): LinkRow | null {
  const owner = getLinkBySheetId(sheetId);
  if (owner && owner.id !== linkId) return null;
  if (!getLink(linkId)) return null;
  // The `sheet_id IS NULL` guard keeps a row that is already bound to another
  // sheet row from being silently re-pointed.
  db.prepare("UPDATE links SET sheet_id = ? WHERE id = ? AND sheet_id IS NULL").run(sheetId, linkId);
  return getLink(linkId) ?? null;
}

/**
 * Insert or update a link.
 *
 * `short_url` is NOT the key: the sheet carries two different products on the
 * same short link, so a unique constraint there would drop one. `sheet_id`
 * (the sheet's `id` column) identifies the product row and is unique per row;
 * when it is null the short_url is used so plain manually-added links still
 * stay idempotent.
 */
export function addLink(input: {
  short_url: string;
  resolved_url?: string | null;
  note?: string | null;
  product?: string | null;
  image_url?: string | null;
  deskripsi?: string | null;
  kategori?: string | null;
  sheet_id?: number | null;
}): LinkRow {
  // No sheet id: the row is not tied to the sheet, so the short_url is the
  // identity and an existing row is returned as-is (idempotent re-add).
  if (input.sheet_id == null) {
    const existing = getLinkByUrl(input.short_url);
    if (existing) return existing;
  }
  // Guard the conflict path first. `ON CONFLICT(sheet_id) DO UPDATE` would
  // happily rewrite a row that already owns that sheet_id, i.e. overwrite a
  // different product's link. Refuse instead and let the caller keep its row.
  if (input.sheet_id != null) {
    const owner = getLinkBySheetId(input.sheet_id);
    if (owner && owner.short_url !== input.short_url) {
      throw new Error(
        `sheet_id ${input.sheet_id} is already bound to a different link (row ${owner.id})`,
      );
    }
  }
  const ids = parseShopee(input.resolved_url ?? input.short_url);
  db.prepare(
    `INSERT INTO links (shop, short_url, resolved_url, shopee_shop_id, shopee_item_id, note, product, image_url, deskripsi, kategori, sheet_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(sheet_id) DO UPDATE SET
       short_url = excluded.short_url,
       resolved_url = COALESCE(excluded.resolved_url, links.resolved_url),
       shopee_shop_id = COALESCE(excluded.shopee_shop_id, links.shopee_shop_id),
       shopee_item_id = COALESCE(excluded.shopee_item_id, links.shopee_item_id),
       note = COALESCE(excluded.note, links.note),
       product = COALESCE(excluded.product, links.product),
       image_url = COALESCE(excluded.image_url, links.image_url),
       deskripsi = COALESCE(excluded.deskripsi, links.deskripsi),
       kategori = COALESCE(excluded.kategori, links.kategori)`,
  ).run(
    ids.shop,
    input.short_url,
    input.resolved_url ?? null,
    ids.shopId,
    ids.itemId,
    input.note ?? null,
    input.product ?? null,
    input.image_url ?? null,
    input.deskripsi ?? null,
    input.kategori ?? null,
    input.sheet_id ?? null,
  );
  return input.sheet_id != null ? getLinkBySheetId(input.sheet_id)! : getLinkByUrl(input.short_url)!;
}

export function getLinkByUrl(shortUrl: string): LinkRow | undefined {
  return db.prepare(`SELECT * FROM links WHERE short_url = ?`).get(shortUrl) as LinkRow | undefined;
}

/** Look up a link by its sheet row id — the natural key for sheet-backed rows. */
export function getLinkBySheetId(sheetId: number): LinkRow | undefined {
  return db.prepare(`SELECT * FROM links WHERE sheet_id = ?`).get(sheetId) as LinkRow | undefined;
}

/**
 * Point a link at a new image (used by the recreate-image endpoint). Only the
 * image column is touched — sourcing fields stay as they were.
 */
export function updateLinkImage(id: number, image_url: string): void {
  // image_original is write-once: the first persisted image is the Shopee
  // og:image, so it stays as the regeneration reference + mismatch baseline.
  const cur = getLink(id);
  if (cur && !cur.image_original && cur.image_url && /^https?:\/\//i.test(cur.image_url)) {
    db.prepare("UPDATE links SET image_url = ?, image_original = ? WHERE id = ?").run(image_url, cur.image_url, id);
    return;
  }
  db.prepare("UPDATE links SET image_url = ? WHERE id = ?").run(image_url, id);
}

export function markLinkPublished(id: number, postUrl?: string | null): void {
  db.prepare(
    `UPDATE links
       SET published_count = published_count + 1,
           last_published_at = datetime('now'),
           published_at = datetime('now'),
           published_url = COALESCE(?, published_url),
           is_published = '1'
     WHERE id = ?`
  ).run(postUrl ?? null, id);
}

/**
 * Reconcile the published markers on links from the content table — the one
 * source of truth. published_count counts content rows with status='published'
 * per link (each platform row counts once), so auto-publish slots and manual
 * publishes converge to the same number and old rows never marked get fixed.
 * Returns the number of link rows touched. Safe to run every scheduler tick.
 */
export function syncLinkMarkers(): number {
  const rows = db.prepare(
    `SELECT c.link_id AS id,
            count(*) AS n,
            max(c.created_at) AS last,
            (SELECT c2.post_url FROM content c2
              WHERE c2.link_id = c.link_id AND c2.status = 'published' AND c2.post_url IS NOT NULL
                AND c2.platform = 'instagram'
              ORDER BY c2.id DESC LIMIT 1) AS url_ig,
            (SELECT c2.post_url FROM content c2
              WHERE c2.link_id = c.link_id AND c2.status = 'published' AND c2.post_url IS NOT NULL
                AND c2.platform != 'threads'
              ORDER BY c2.id DESC LIMIT 1) AS url_np,
            (SELECT c2.post_url FROM content c2
              WHERE c2.link_id = c.link_id AND c2.status = 'published' AND c2.post_url IS NOT NULL
                AND c2.post_url NOT LIKE '%/@me/%'
              ORDER BY c2.id DESC LIMIT 1) AS url_any
       FROM content c
      WHERE c.status = 'published' AND c.link_id IS NOT NULL
      GROUP BY c.link_id`
  ).all() as { id: number; n: number; last: string; url_ig: string | null; url_np: string | null; url_any: string | null }[];
  const stmt = db.prepare(
    `UPDATE links
       SET published_count = ?,
           last_published_at = ?,
           published_at = COALESCE(published_at, ?),
           published_url = CASE
             WHEN ? IS NOT NULL
                  AND (published_url IS NULL OR published_url LIKE '%/@me/%' OR (? LIKE '%instagram.com%' AND published_url NOT LIKE '%instagram.com%'))
             THEN ? ELSE published_url END,
           is_published = '1'
     WHERE id = ?`
  );
  let touched = 0;
  for (const r of rows) {
    // preferensi permalink: Instagram > platform lain > apa pun yang bukan @me
    const url = r.url_ig ?? r.url_np ?? r.url_any ?? null;
    stmt.run(r.n, r.last, r.last, url, url, url, r.id);
    touched++;
  }
  return touched;
}

/** Backfill the permalink once Instagram publishes it (post_id precedes it). */
export function setContentPostUrl(id: number, postUrl: string): void {
  db.prepare("UPDATE content SET post_url = ?, updated_at = datetime('now') WHERE id = ?").run(postUrl, id);
}

export function setLinkPublishedUrl(id: number, postUrl: string): void {
  db.prepare("UPDATE links SET published_url = ? WHERE id = ? AND (published_url IS NULL OR published_url = '')").run(postUrl, id);
}

/**
 * Seal the original Shopee image on a link (write-once). Called by the
 * scrape pipeline; recreate never touches this column afterwards.
 */
export function sealOriginalImage(id: number, original: string): void {
  db.prepare("UPDATE links SET image_original = COALESCE(image_original, ?) WHERE id = ?").run(original, id);
}

export function getLink(id: number): LinkRow | undefined {
  return db.prepare(`SELECT * FROM links WHERE id = ?`).get(id) as LinkRow | undefined;
}

export function listLinks(): LinkRow[] {
  return db.prepare(`SELECT * FROM links ORDER BY id DESC`).all() as unknown as LinkRow[];
}

export function addContent(input: {
  link_id: number;
  platform: string;
  kind?: ContentRow["kind"];
  body: string;
  media_url?: string | null;
  first_comment?: string | null;
}): ContentRow {
  db.prepare(
    `INSERT INTO content (link_id, platform, kind, body, media_url, first_comment)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    input.link_id,
    input.platform,
    input.kind ?? "text",
    input.body,
    input.media_url ?? null,
    input.first_comment ?? null,
  );
  const row = db.prepare(`SELECT * FROM content WHERE id = last_insert_rowid()`).get() as ContentRow;
  return row;
}

export function listContent(linkId?: number): ContentRow[] {
  if (linkId) {
    return db.prepare(`SELECT * FROM content WHERE link_id = ? ORDER BY id DESC`).all(linkId) as unknown as ContentRow[];
  }
  return db.prepare(`SELECT * FROM content ORDER BY id DESC`).all() as unknown as ContentRow[];
}

export interface ReplyRow {
  id: number;
  content_id: number;
  comment_id: string;
  comment_user: string | null;
  comment_text: string | null;
  reply_text: string;
  reply_id: string | null;
  created_at: string;
}

/** comment_ids already answered — one reply per comment, enforced here. */
export function answeredCommentIds(): Set<string> {
  const rows = db.prepare(`SELECT comment_id FROM thread_replies`).all() as Array<{ comment_id: string }>;
  return new Set(rows.map((r) => r.comment_id));
}

export function recordReply(input: {
  content_id: number; comment_id: string; comment_user?: string | null;
  comment_text?: string | null; reply_text: string; reply_id?: string | null;
}): void {
  db.prepare(
    `INSERT OR IGNORE INTO thread_replies
     (content_id, comment_id, comment_user, comment_text, reply_text, reply_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    input.content_id, input.comment_id, input.comment_user ?? null,
    input.comment_text ?? null, input.reply_text, input.reply_id ?? null,
  );
}

export function listReplies(contentId?: number): ReplyRow[] {
  if (contentId) {
    return db.prepare(`SELECT * FROM thread_replies WHERE content_id = ? ORDER BY id DESC`).all(contentId) as unknown as ReplyRow[];
  }
  return db.prepare(`SELECT * FROM thread_replies ORDER BY id DESC LIMIT 100`).all() as unknown as ReplyRow[];
}

export function setContentStatus(
  id: number,
  status: ContentRow["status"],
  extra: { post_id?: string | null; post_url?: string | null; error?: string | null } = {},
): void {
  db.prepare(
    `UPDATE content SET status = ?, post_id = COALESCE(?, post_id),
     post_url = COALESCE(?, post_url), error = COALESCE(?, error),
     updated_at = datetime('now') WHERE id = ?`,
  ).run(
    status,
    extra.post_id ?? null,
    extra.post_url ?? null,
    extra.error ?? null,
    id,
  );
}

/** Store the scraped og:title/og:image/og:description + category for a link. Keeps whatever was already there on null. */
export function enrichLink(
  id: number,
  patch: { product?: string | null; image_url?: string | null; deskripsi?: string | null; kategori?: string | null },
): void {
  const current = getLink(id) as (LinkRow & { deskripsi?: string | null }) | undefined;
  if (!current) return;
  db.prepare(`UPDATE links SET product = ?, image_url = ?, deskripsi = ?, kategori = ? WHERE id = ?`).run(
    patch.product ?? current.product ?? null,
    patch.image_url ?? current.image_url ?? null,
    patch.deskripsi ?? current.deskripsi ?? null,
    patch.kategori ?? current.kategori ?? null,
    id,
  );
}

/**
 * Delete a link and its content. SQLite cascade depends on
 * `PRAGMA foreign_keys = ON` surviving every connection; this does not, so the
 * delete is explicit here.
 */
export function deleteLink(id: number): void {
  db.prepare(`DELETE FROM content WHERE link_id = ?`).run(id);
  db.prepare(`DELETE FROM links WHERE id = ?`).run(id);
}

export function dropAll(): void {
  db.exec(`DROP TABLE IF EXISTS content; DROP TABLE IF EXISTS links;`);
}

export { db as store };
