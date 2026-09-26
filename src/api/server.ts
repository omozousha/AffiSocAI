/**
 * HTTP API — node:http, zero dependencies.
 *
 * Routes:
 *   GET  /api/providers            capability matrix + verification status
 *   GET  /api/providers/:slug/account
 *   POST /api/providers/:slug/validate   { text, mediaUrl, mediaKind, scheduledAt }
 *   POST /api/providers/:slug/publish    { text, mediaUrl, mediaKind, scheduledAt }
 *   GET  /api/providers/:slug/analytics/:postId
 *   POST /api/run-check            proves the CLI transport still executes
 */

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getProvider, listProviders } from "../core/registry.ts";
import { composio } from "../core/composio.ts";
import { addLink, addContent, listContent, listLinks, getLink, getLinkBySheetId, enrichLink } from "../core/store.ts";
import { buildTemplates, productName } from "../core/templates.ts";
import { fetchOg, checkImageUrl } from "../core/shopee.ts";
import { fetchBioItems, nextIds, importableItems, publishToBio } from "../core/biolink.ts";
import { addLinksBulk, parseLinkBlob, normaliseLink } from "../core/add-link.ts";
import {
  listActivity,
  listActivitySince,
  dbLogMaxId,
  activityStats,
  logActivity,
  pruneActivity,
  type ActivityLevel,
  type ActivitySource,
} from "../core/activity-log.ts";
import { recreateProductImage } from "../core/recreate-image.ts";
import type { SocialContent } from "../core/types.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8787);

function json(res: import("node:http").ServerResponse, code: number, body: unknown) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
  res.end(payload);
}

async function readBody(req: import("node:http").IncomingMessage): Promise<SocialContent> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const text = Buffer.concat(chunks).toString("utf8").trim();
  return text ? JSON.parse(text) : {};
}

/**
 * A stored image_url may be a public http(s) url (Shopee CDN) or a local
 * server path (`/api/images/…`) written by the enrich step. The sheet demands
 * an absolute url, so a local path becomes the public origin. Returns "" for
 * anything that is neither — `publishToBio` treats empty as "no image".
 */
function absoluteImageUrl(url: string | null | undefined): string {
  const u = (url ?? "").trim();
  if (!u) return "";
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith("/")) {
    const origin = process.env.BIO_PUBLIC_BASE ?? `http://${process.env.HOST ?? "127.0.0.1"}:${process.env.PORT ?? "8787"}`;
    return origin + u;
  }
  return "";
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

function mimeOf(file: string) {
  return MIME[/\.[^.]+$/.exec(file)?.[0].toLowerCase() || ""] || "application/octet-stream";
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://localhost:${PORT}`);
  const parts = url.pathname.split("/").filter(Boolean); // ["api","providers",...]
  const t0 = Date.now();
  let status = 0;
  let capturedError: unknown = null;

  // capture the status/body of every response so the log row is real, not guessed
  const origWriteHead = res.writeHead.bind(res);
  (res as any).writeHead = (code: number, ...rest: unknown[]) => {
    status = code;
    return (origWriteHead as any)(code, ...rest);
  };
  try {
  /**
   * Static files under public/. Only paths that resolve inside PUBLIC_DIR are
   * served — the index.html shell, /assets/*.css and /js/*.js route modules.
   * Everything else falls through to the API handlers below.
   */
  if (req.method === "GET" && !url.pathname.startsWith("/api/")) {
    const rel = url.pathname === "/" ? "/index.html" : url.pathname;
    const file = join(HERE, "..", "..", "public", rel);
    const inside = file.startsWith(join(HERE, "..", "..", "public") + "/");
    if (!inside) return json(res, 403, { error: "forbidden" });
    try {
      const buf = await readFile(file);
      res.writeHead(200, { "content-type": mimeOf(file) });
      return res.end(buf);
    } catch {
      /* not a static file — fall through to the API routes */
    }
  }

    if (req.method === "GET" && url.pathname === "/api/providers") {
      return json(res, 200, {
        providers: listProviders().map((p) => ({
          slug: p.slug,
          displayName: p.displayName,
          status: p.status,
          blockedReason: p.blockedReason ?? null,
          capabilities: p.capabilities,
        })),
      });
    }

    if (req.method === "GET" && url.pathname === "/api/run-check") {
      const r = await composio.execute("INSTAGRAM_GET_USER_INFO", { ig_user_id: "me" });
      return json(res, r.ok ? 200 : 502, {
        ok: r.ok,
        durationMs: r.durationMs,
        account: r.data ? { username: r.data.username, followers: r.data.followers_count } : null,
        error: r.error,
      });
    }

    if (req.method === "GET" && url.pathname === "/api/links") {
      return json(res, 200, { links: listLinks() });
    }

    /**
     * Activity log. Every /api/* request lands here with its real status and
     * duration; failures additionally carry the error text. Read-only.
     *   GET /api/logs?level=error&search=composio&limit=100
     */
    if (req.method === "GET" && url.pathname === "/api/logs") {
      const levels = url.searchParams.getAll("level");
      const q = {
        limit: Number(url.searchParams.get("limit") ?? 200),
        offset: Number(url.searchParams.get("offset") ?? 0),
        level: (levels.length ? levels : undefined) as ActivityLevel | ActivityLevel[] | undefined,
        source: (url.searchParams.get("source") ?? undefined) as ActivitySource | undefined,
        search: url.searchParams.get("search") ?? undefined,
        method: url.searchParams.get("method") ?? undefined,
        path_like: url.searchParams.get("path") ?? undefined,
      };
      const rows = listActivity(q);
      return json(res, 200, { rows, stats: activityStats(), next_offset: rows.length ? q.offset + rows.length : null });
    }

    /** Server-sent events: pushes new log rows to the Logs page as they land. */
    if (req.method === "GET" && url.pathname === "/api/logs/stream") {
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      });
      res.write(`: connected\n\n`);
      let cursor = 0;
      try {
        const latest = dbLogMaxId();
        cursor = Number.isFinite(latest) ? latest : 0;
      } catch { /* start from zero */ }
      const timer = setInterval(() => {
        const rows = listActivitySince(cursor);
        if (!rows.length) return;
        cursor = rows[0].id;
        for (const r of rows.reverse()) res.write(`data: ${JSON.stringify(r)}\n\n`);
      }, 2000);
      req.on("close", () => { clearInterval(timer); res.end(); });
      return;
    }

    /**
     * Add link(s) — the primary input path.
     *   single:  { "short_url": "https://s.shopee.co.id/xxx" }
     *   bulk:    { "links": "https://...\nhttps://..." }  or  { "links": ["https://...", "https://..."] }
     *   dry-run: { "dryRun": true }  → og + image probe, nothing stored, nothing appended
     * Auto-fetches og:title / og:image, verifies the image is fetchable, stores
     * the row and appends it to the bio Google Sheet (sequentially).
     */
    if (req.method === "POST" && url.pathname === "/api/links") {
      const body = (await readBody(req)) as {
        short_url?: string;
        links?: string | string[];
        dryRun?: boolean;
        kategori?: string;
      };
      const blob = typeof body.links === "string" ? body.links : Array.isArray(body.links) ? body.links.join("\n") : "";
      const blobInputs = blob ? parseLinkBlob(blob) : [];
      const inputs = blobInputs.length
        ? blobInputs
        : body.short_url
          ? [{ short_url: body.short_url }]
          : [];
      if (inputs.length === 0) {
        return json(res, 400, { error: "short_url or links is required", hint: "one Shopee link per line in `links`" });
      }
      if (body.kategori) for (const i of inputs) i.kategori = body.kategori;
      const dryRun = body.dryRun === true;
      if (dryRun) {
        const dry = await addLinksBulk(inputs, { dryRun: true });
        return json(res, 200, { dryRun: true, ...dry });
      }
      const result = await addLinksBulk(inputs);
      return json(res, result.rejected === result.total ? 422 : 201, result);
    }

    /** Re-scrape og:title / og:image for a stored link and persist them. */
    if (req.method === "POST" && /^\/api\/links\/\d+\/enrich$/.test(url.pathname)) {
      const id = Number(url.pathname.split("/")[3]);
      const link = getLink(id);
      if (!link) return json(res, 404, { error: `no link with id ${id}` });
      const og = await fetchOg(link.short_url);
      if (!og.title && !og.image) {
        return json(res, 502, { error: "could not read og tags from the link" });
      }
      let imageOk = false;
      if (og.image) {
        const probe = await checkImageUrl(og.image);
        imageOk = probe.ok;
        if (!imageOk) {
          return json(res, 502, { error: `og:image not usable: ${probe.reason}` });
        }
      }
      enrichLink(id, { product: productName(og.title), image_url: og.image });
      const updated = getLink(id)!;
      return json(res, 200, {
        link: updated,
        product: updated.product,
        image_url: updated.image_url,
        imageVerifiedFetchable: imageOk,
      });
    }

    if (req.method === "GET" && url.pathname === "/api/content") {
      const linkId = url.searchParams.get("link_id");
      const platform = url.searchParams.get("platform");
      const rows = listContent(linkId ? Number(linkId) : undefined);
      return json(res, 200, {
        content: platform ? rows.filter((r) => r.platform === platform) : rows,
      });
    }

    /** Live list the bio page renders. */
    if (req.method === "GET" && url.pathname === "/api/bio/items") {
      const items = await fetchBioItems();
      return json(res, 200, { count: items.length, next: nextIds(items), items });
    }

    /**
     * Push a stored link onto the bio sheet.
     *   { "link_id": 3, "kategori": "Fasion", "deskripsi": "..." }
     * Idempotent: a link already on the bio page returns already instead of
     * writing a second row. Needs an image — the page renders images.
     */
    if (req.method === "POST" && url.pathname === "/api/bio/publish") {
      const body = await readBody(req);
      const link = getLink(Number(body.link_id));
      if (!link) return json(res, 404, { error: `no link with id ${body.link_id}` });

      // The sheet is the source of truth for images: a row published earlier
      // renders from the sheet even when the db row lost its image_url (the
      // eSIM restore path drops it). Fall back to the sheet image before
      // refusing, otherwise an already-published link reports "no image".
      let image = absoluteImageUrl(link.image_url);
      if (!image) {
        try {
          const items = await fetchBioItems();
          const own = items.find((i) => (i.link || "") === link.short_url
            || (i.link || "") === (link.original_url ?? ""));
          if (own && own.images.length > 0) image = absoluteImageUrl(own.images[0]);
        } catch { /* sheet unreachable — fall through to the image_url error */ }
      }
      if (!image) return json(res, 400, { error: "link has no image_url — run /api/links/:id/enrich first" });

      const result = await publishToBio({
        title: link.product ?? link.short_url,
        deskripsi: body.deskripsi ?? `Produk pilihan ${link.shop ?? "toko ini"}.`,
        link: link.short_url,
        kategori: body.kategori ?? "Fasion",
        images: [image],
      });

      const code = result.status === "written" ? 201 : 200;
      return json(res, code, { result, link });
    }

    /** Reads the sheet, maps it onto links, refreshes drafts — no writes. */
    if (req.method === "GET" && url.pathname === "/api/bio/sync-preview") {
      const items = await fetchBioItems();
      const rows = importableItems(items);
      const bySheetId = new Map(listLinks().filter((l) => l.sheet_id != null).map((l) => [l.sheet_id, l]));
      return json(res, 200, {
        total: items.length,
        importable: rows.length,
        skipped_test_rows: items.length - rows.length,
        rows: rows.map((i) => {
          const existing = bySheetId.get(Number(i.id));
          return {
            sheet_id: Number(i.id),
            title: i.title,
            kategori: i.kategori,
            link: i.link,
            image: i.images[0] ?? null,
            in_db: !!existing,
            link_id: existing?.id ?? null,
          };
        }),
      });
    }

    /**
     * Import the sheet's real product rows into the local DB.
     * Idempotent on short_url — a row already stored is left untouched.
     * Never writes back to the sheet.
     */
    if (req.method === "POST" && url.pathname === "/api/bio/import") {
      const items = await fetchBioItems();
      const rows = importableItems(items);
      const created: number[] = [];
      const skipped: string[] = [];
      for (const i of rows) {
        const sheetId = Number(i.id);
        if (getLinkBySheetId(sheetId)) {
          skipped.push(i.link);
          continue;
        }
        const img = i.images.find((u) => /^https?:\/\//i.test(u)) ?? null;
        const link = addLink({
          short_url: i.link,
          product: i.title,
          image_url: img,
          kategori: i.kategori,
          sheet_id: sheetId,
        });
        created.push(link.id);
      }
      return json(res, 201, { created, skipped, total: rows.length });
    }

    if (req.method === "POST" && url.pathname === "/api/content") {
      const body = await readBody(req);
      if (!body.link_id || !body.platform || !body.body)
        return json(res, 400, { error: "link_id, platform and body are required" });
      const link = getLink(body.link_id);
      if (!link) return json(res, 404, { error: `no link with id ${body.link_id}` });
      const row = addContent(body);
      return json(res, 201, { content: row });
    }

    if (req.method === "POST" && url.pathname === "/api/content/generate") {
      const body = await readBody(req);
      const link = getLink(Number(body.link_id));
      if (!link) return json(res, 404, { error: `no link with id ${body.link_id}` });
      const linkUrl = body.short_url || link.short_url;
      const platforms = Array.isArray(body.platforms) && body.platforms.length ? body.platforms : ["instagram", "facebook", "x"];
      const drafts = buildTemplates(link, linkUrl, platforms);
      return json(res, 200, { drafts: drafts.map((d) => ({ ...d, status: "not-persisted" })) });
    }

    if (parts[0] === "api" && parts[1] === "providers") {
      const slug = parts[2];
      const provider = getProvider(slug);
      if (!provider) return json(res, 404, { error: `unknown provider: ${slug}` });

      if (req.method === "GET" && parts[3] === "account") {
        const account = await provider.getAccount();
        return json(res, account ? 200 : 503, { account, blockedReason: provider.blockedReason ?? null });
      }

      if (req.method === "POST" && parts[3] === "validate") {
        const body = await readBody(req);
        return json(res, 200, await provider.validateContent(body));
      }

      if (req.method === "POST" && parts[3] === "publish") {
        const body = await readBody(req);
        const result = await provider.publish(body);
        return json(res, result.ok ? 200 : 422, result);
      }

      if (req.method === "GET" && parts[3] === "analytics" && parts[4]) {
        if (!provider.getAnalytics) return json(res, 501, { error: "analytics not implemented for this provider" });
        return json(res, 200, await provider.getAnalytics(parts[4]));
      }
    }

    if (req.method === "POST" && /^\/api\/links\/\d+\/recreate-image$/.test(url.pathname)) {
      const id = Number(url.pathname.split("/")[3]);
      const link = getLink(id);
      if (!link) return json(res, 404, { error: `no link with id ${id}` });
      if (!link.image_url) return json(res, 400, { error: "link has no image_url to recreate" });
      const body = (await readBody(req)) as { prompt?: string };
      const out = await recreateProductImage(link, body.prompt);
      return json(res, out.ok ? 200 : 502, out);
    }

    /** Serve recreated images out of data/images/:file. */
    if (req.method === "GET" && parts[0] === "api" && parts[1] === "images" && parts[2]) {
      const { readStoredImage } = await import("../core/recreate-image.ts");
      const img = await readStoredImage(parts[2]);
      if (!img) return json(res, 404, { error: "no such image" });
      res.writeHead(200, { "Content-Type": img.mime, "Cache-Control": "public, max-age=31536000, immutable" });
      return res.end(img.buf);
    }

    return json(res, 404, { error: "not found" });
  } catch (e) {
    capturedError = e;
    return json(res, 500, { error: String(e) });
  } finally {
    // The log row is written for every request — 2xx included — but only for
    // the routes this app actually serves. Static asset hits (css/js) would
    // drown the log in noise, so they stay out, as do the log endpoints
    // themselves (the Logs page would otherwise watch itself type).
    const selfLog = url.pathname === "/api/logs" || url.pathname === "/api/logs/stream";
    if (url.pathname.startsWith("/api/") && !selfLog) {
      const failed = status >= 500 || capturedError !== null;
      logActivity({
        level: failed ? "error" : status >= 400 ? "warn" : "info",
        source: "api",
        event: capturedError ? "request.error" : "request",
        method: req.method,
        path: url.pathname,
        status: status || (capturedError ? 500 : 200),
        duration_ms: Date.now() - t0,
        message: capturedError ? String(capturedError) : null,
        meta: url.search ? { query: url.search } : null,
      });
    }
    if (Math.random() < 0.01) pruneActivity();
  }
});

server.listen(PORT, () => {
  console.log(`affiliate-tools API on http://localhost:${PORT}`);
  console.log("providers:", listProviders().map((p) => `${p.slug}:${p.status}`).join("  "));
});
