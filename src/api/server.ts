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
import { buildMysteryCaption, mysteryKind, MYSTERY_PLATFORMS, type MysteryDraft } from "../core/mystery-caption.ts";
import { fetchOg, checkImageUrl } from "../core/shopee.ts";
import { fetchBioItems, nextIds, importableItems, publishToBio } from "../core/biolink.ts";
import { addLinksBulk, parseLinkBlob, normaliseLink } from "../core/add-link.ts";
import {
  listSlots,
  schedulerStatus,
  trendReport,
  setSlotTimes,
  setSchedulerEnabled,
  ensureHorizon,
  runSlotNow,
  startScheduler,
} from "../core/scheduler.ts";
import {
  listActivity, listActivitySince,
  dbLogMaxId,
  activityStats,
  logActivity,
  pruneActivity,
  type ActivityLevel,
  type ActivitySource,
} from "../core/activity-log.ts";
import { recreateProductImage } from "../core/recreate-image.ts";
import { IMAGE_PRESETS, DEFAULT_PRESET } from "../core/image-presets.ts";
import { authorizeUrl, exchangeCode, clearThreadsToken } from "../providers/threads.ts";
import type { SocialContent } from "../core/types.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8787);

function envBool(name: string): boolean {
  return /^(1|true|yes|on)$/i.test(String(process.env[name] || "").trim());
}

/** Escapes untrusted text before it lands in the authorize page. */
function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;",
  );
}

/** Small standalone page shown after Meta redirects the callback. */
function authorizePage(title: string, message: string): string {
  return `<!doctype html><html lang="id"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} · Threads</title>
<style>
:root{color-scheme:dark}
body{margin:0;display:grid;place-items:center;min-height:100vh;background:#0b0e14;
     color:#e8ecf4;font:15px/1.5 system-ui,-apple-system,sans-serif}
.c{max-width:22rem;padding:2rem;text-align:center}
h1{font-size:1.15rem;margin:0 0 .5rem}
p{margin:0;color:#9aa5b8}
</style></head><body><div class="c">
<h1>${escapeHtml(title)}</h1><p>${message}</p>
</div></body></html>`;
}

function json(res: import("node:http").ServerResponse, code: number, body: unknown) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
  return res.end(payload);
}

function html(res: import("node:http").ServerResponse, code: number, markup: string) {
  res.writeHead(code, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  return res.end(markup);
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
    // url.pathname never includes the query, so "?v=2" cache-busters resolve
    // to the real file on disk.
    const rel = url.pathname === "/" ? "/index.html" : url.pathname;
    const pub = join(HERE, "..", "..", "public");
    const file = join(pub, rel);
    const inside = file.startsWith(pub + "/");
    if (!inside) return json(res, 403, { error: "forbidden" });
    try {
      const buf = await readFile(file);
      // HTML and JS/CSS route modules are no-store: Cloudflare in front of this
      // origin plus browser heuristics otherwise serve stale UI after a deploy.
      const noStore = /\.(html|js|css)$/.test(file);
      res.writeHead(200, {
        "content-type": mimeOf(file),
        "cache-control": noStore
          ? "no-store, no-cache, must-revalidate, max-age=0"
          : "public, max-age=86400",
      });
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

    // --- Scheduler -------------------------------------------------------
    // 3 slots a day, in-process. These routes are status + control only: the
    // actual publish is driven by the tick loop, so a POST here never blocks
    // on a media upload.
    if (req.method === "GET" && url.pathname === "/api/schedule") {
      return json(res, 200, {
        status: schedulerStatus(),
        slots: listSlots({ date: url.searchParams.get("date") ?? undefined, limit: 100 }),
        trend: trendReport(Number(url.searchParams.get("window") ?? 7) || 7),
      });
    }

    /** slot_times, enabled, and a rolling horizon top-up. */
    if (req.method === "POST" && url.pathname === "/api/schedule/config") {
      const body = await readBody(req);
      if (body.enabled !== undefined) setSchedulerEnabled(Boolean(body.enabled));
      if (body.slot_times !== undefined) {
        try {
          setSlotTimes(String(body.slot_times).split(","));
        } catch (e) {
          return json(res, 400, { error: String(e).slice(0, 200) });
        }
        ensureHorizon(2);
      }
      return json(res, 200, { status: schedulerStatus() });
    }

    /**
     * Publish one slot immediately, ignoring its scheduled time.
     *   POST /api/schedule/run { "slot_id": 3 }
     * Returns the slot after its outcome is stored, so the caller sees a
     * `failed` status with the reason instead of a fake 200.
     */
    if (req.method === "POST" && url.pathname === "/api/schedule/run") {
      const body = await readBody(req);
      const id = Number(body.slot_id ?? url.searchParams.get("slot_id"));
      if (!Number.isInteger(id) || id <= 0) return json(res, 400, { error: "slot_id is required" });
      try {
        const slot = await runSlotNow(id);
        return json(res, slot.status === "published" ? 200 : 502, { slot });
      } catch (e) {
        return json(res, 409, { error: String(e).slice(0, 300) });
      }
    }

    /** Rebuild today's (and tomorrow's) slots — used after editing slot_times. */
    if (req.method === "POST" && url.pathname === "/api/schedule/refresh") {
      return json(res, 200, { created: ensureHorizon(2), status: schedulerStatus() });
    }

    /** Live scheduler health — consumed by the Jadwal route's status dot. */
    if (req.method === "GET" && url.pathname === "/api/schedule/health") {
      const s = schedulerStatus();
      const ready = s.platforms.filter((p) => p.ready);
      return json(res, 200, {
        ok: s.enabled && ready.length > 0,
        enabled: s.enabled,
        ready_platforms: ready.map((p) => p.slug),
        next: s.next,
        today_published: s.today.published,
      });
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

    /** Mystery drafts: same data, product name withheld from the caption. */
    if (req.method === "POST" && url.pathname === "/api/content/mystery") {
      const body = await readBody(req);
      const link = getLink(Number(body.link_id));
      if (!link) return json(res, 404, { error: `no link with id ${body.link_id}` });
      const platforms = Array.isArray(body.platforms) && body.platforms.length ? body.platforms : MYSTERY_PLATFORMS;
      const drafts = platforms.map((p: MysteryDraft["platform"]) => buildMysteryCaption(p, link));
      const mediaUrl = link.image_url ?? null;
      return json(res, 200, {
        drafts: drafts.map((d) => ({
          ...d,
          kind: mysteryKind(mediaUrl),
          media_url: mediaUrl,
          linkPlacement: "bio",
          firstComment: null,
          status: "not-persisted",
        })),
      });
    }

    // --- Threads connect (Meta Threads API, OAuth 2.0) ---------------
    // Placed before the /api/providers block: those routes 404 unknown slugs,
    // and these are not provider-crud routes.
    //
    // The old flow captured a browser cookie. It cannot work: Meta marks
    // `sessionid` HttpOnly, so the capture page's `document.cookie` never sees
    // it, and the automated login this headless host would need is refused by
    // Meta's device check. The API path uses a refreshable token stored 0600
    // outside the repo, which both problems are solved by.
    if (req.method === "GET" && url.pathname === "/api/providers/threads/authorize") {
      const r = authorizeUrl();
      if ("error" in r) return json(res, 503, { error: r.error });
      logActivity("info", "sosmed", "threads authorization window minted", {});
      return json(res, 200, r);
    }

    // Meta redirects here with ?code=… once the operator approves.
    if (req.method === "GET" && url.pathname === "/api/providers/threads/callback") {
      const code = url.searchParams.get("code") || "";
      const err = url.searchParams.get("error");
      if (err) {
        logActivity("warn", "sosmed", "threads authorization refused", { error: err });
        return html(res, 200, authorizePage("Dibatalkan", "Authorisasi dibatalkan. Tutup halaman ini lalu coba lagi."));
      }
      if (!code) {
        return html(res, 400, authorizePage("Tidak ada kode", "Meta tidak mengirim kode otorisasi. Coba lagi dari Sosmed."));
      }
      const result = await exchangeCode(code);
      if (!result.ok) {
        logActivity("warn", "sosmed", "threads token exchange failed", { error: result.error });
        return html(res, 502, authorizePage("Gagal", escapeHtml(result.error ?? "token exchange gagal")));
      }
      const account = await getProvider("threads")?.getAccount();
      logActivity("info", "sosmed", "threads connected", {
        username: account?.username ?? null,
        accountId: account?.id ?? null,
      });
      return html(res, 200, authorizePage(
        "Terhubung",
        account?.username ? `Threads @${escapeHtml(account.username)} siap posting.` : "Threads terhubung.",
      ));
    }

    // Clears the connection so the operator can re-authorise.
    if (req.method === "POST" && url.pathname === "/api/providers/threads/reset") {
      const cleared = clearThreadsToken();
      logActivity("info", "sosmed", "threads connection cleared", { cleared });
      return json(res, 200, { ok: true, cleared });
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

      // Threads uses OAuth, not a browser session. The connection state is
      // derived from the stored token, and the UI's "Hubungkan" button calls
      // GET /api/providers/threads/authorize.
      if (req.method === "GET" && parts[3] === "session" && parts[2] === "threads") {
        const p = getProvider("threads");
        const account = await p?.getAccount();
        return json(res, 200, {
          live: Boolean(account),
          username: account?.username ?? null,
          connected: Boolean(account),
          blockedReason: p?.blockedReason ?? null,
        });
      }
    }

    if (req.method === "POST" && /^\/api\/links\/\d+\/recreate-image$/.test(url.pathname)) {
      const id = Number(url.pathname.split("/")[3]);
      const link = getLink(id);
      if (!link) return json(res, 404, { error: `no link with id ${id}` });
      if (!link.image_url) return json(res, 400, { error: "link has no image_url to recreate" });
      const body = (await readBody(req)) as { prompt?: string; preset?: string };
      const out = await recreateProductImage(link, body.prompt, body.preset);
      return json(res, out.ok ? 200 : 502, out);
    }

    /** Preset list for the image-recreate picker in the UI. */
    if (req.method === "GET" && url.pathname === "/api/image-presets") {
      return json(res, 200, { presets: IMAGE_PRESETS, default: DEFAULT_PRESET });
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
  // Backfills the rolling horizon and starts the 60 s tick loop. Safe to call
  // on every boot: slot_times and already-published slots are idempotent.
  ensureHorizon(2);
  startScheduler();
  const st = schedulerStatus();
  console.log(
    `scheduler: ${st.enabled ? "enabled" : "paused"}  slots=${st.slot_times.join(",")}  ` +
      `platforms=${st.platforms.filter((p) => p.ready).map((p) => p.slug).join(",") || "none"}`,
  );
});
