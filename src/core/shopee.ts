/**
 * Shopee metadata fetch — zero dependencies.
 *
 * The product page is a JS SPA: a normal UA gets an empty shell with no
 * og:image in it. Meta's own crawler UA gets the server-rendered tags, which is
 * also the best proxy for "can Meta fetch this image".
 *
 * It shells out to curl on purpose. Node's TLS stack (undici / node:https)
 * presents a different JA3 fingerprint than curl and Shopee answers every Node
 * request with 403 + error 90309999, even with identical headers. curl is
 * present on every target this runs on (verified: /usr/bin/curl 8.5.0).
 */

import { spawn } from "node:child_process";

export type OgMeta = {
  title: string | null;
  image: string | null;
  description: string | null;
};

const CRAWLER_UA =
  "Twitterbot/1.0";

function tag(html: string, prop: string): string | null {
  const m = html.match(new RegExp(`<meta[^>]+property=["']og:${prop}["'][^>]+content=["']([^"']*)["']`));
  return m ? m[1] : null;
}

/** Run curl and collect stdout. Bounded by timeoutMs; throws on non-zero exit. */
function curl(args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn("curl", ["-sSL", "--max-time", String(Math.ceil(timeoutMs / 1000)), ...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    p.stdout.on("data", (c) => (out += c));
    p.stderr.on("data", (c) => (err += c));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(`curl exit ${code}: ${err.slice(0, 200)}`))));
  });
}

/** Fetch a URL and pull og:title / og:image / og:description out of the HTML. */
export async function fetchOg(url: string, timeoutMs = 20000): Promise<OgMeta> {
  const html = await curl(["-A", CRAWLER_UA, url], timeoutMs);
  return {
    title: tag(html, "title"),
    image: tag(html, "image"),
    description: tag(html, "description"),
  };
}

/** HEAD-ish probe: status, content-type and size of an image URL. */
export async function checkImageUrl(
  imageUrl: string,
  timeoutMs = 15000,
): Promise<{ ok: boolean; status: number | null; contentType: string | null; bytes: number | null; reason: string | null }> {
  if (!/^https?:\/\//i.test(imageUrl)) {
    return { ok: false, status: null, contentType: null, bytes: null, reason: "url is not http(s)" };
  }
  try {
    const headers = await curl(["-A", CRAWLER_UA, "-o", "/dev/null", "-w", "%{http_code} %{content_type} %{size_download}", imageUrl], timeoutMs);
    const [status, contentType, bytes] = headers.trim().split(/\s+/);
    const ok = status === "200" && !!contentType && /^image\//i.test(contentType) && Number(bytes) > 0;
    return {
      ok,
      status: Number(status),
      contentType: contentType || null,
      bytes: Number(bytes),
      reason: ok ? null : `status=${status} content-type=${contentType} bytes=${bytes}`,
    };
  } catch (e) {
    return { ok: false, status: null, contentType: null, bytes: null, reason: String(e) };
  }
}
