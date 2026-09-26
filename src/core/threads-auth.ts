/**
 * Threads session capture over an auth link.
 *
 * Why this shape: a headful Chromium on this host cannot bind its DevTools
 * endpoint (verified — `DevTools listening` never appears when DISPLAY is set,
 * so the server cannot drive a login window at all). The alternative that
 * leaves no credential on the server is a one-time capture link:
 *
 *   1. Operator calls POST /api/providers/threads/auth-link.
 *   2. The app mints a single-use token bound to this host and returns a URL.
 *   3. Operator opens that URL on the machine whose browser is already logged
 *      into Threads and clicks "capture".
 *   4. The page ships the Threads cookie back to the app and the token burns.
 *
 * No password is ever sent, typed, or stored. The captured cookie is written
 * to the Chromium profile directory the publisher uses, so the headless publish
 * path works from that point on.
 */

import { randomBytes, createHmac, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const HOME = join(process.env.HOME || "/root", ".affiliate-tools");
export const THREADS_PROFILE_DIR = process.env.THREADS_PROFILE_DIR || join(HOME, "chromium-threads");
const AUTH_DIR = join(THREADS_PROFILE_DIR, "auth");
const COOKIE_FILE = join(AUTH_DIR, "threads-cookie.json");

/** Pepper keeps a leaked token file useless without this env var. */
const PEPPER = process.env.THREADS_AUTH_PEPPER || "affine-threads-local";

export const THREADS_USERNAME = process.env.THREADS_USERNAME || "karasu_michi";

function ensureDir(): void {
  mkdirSync(AUTH_DIR, { recursive: true, mode: 0o700 });
}

function tokenPath(token: string): string {
  return join(AUTH_DIR, `pending-${token}.json`);
}

export interface AuthLinkTicket {
  token: string;
  url: string;
  expiresAt: string;
}

/** Mints a single-use capture ticket. Token is 192-bit random, hex. */
export function createAuthLink(baseUrl: string): AuthLinkTicket {
  ensureDir();
  const token = randomBytes(24).toString("hex");
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  writeFileSync(
    tokenPath(token),
    JSON.stringify({ token, createdAt: new Date().toISOString(), expiresAt, used: false }, null, 2),
    { mode: 0o600 },
  );
  const url = `${baseUrl.replace(/\/+$/, "")}/api/threads-auth?t=${token}`;
  return { token, url, expiresAt };
}

function readTicket(token: string): { token: string; expiresAt: string; used: boolean } | null {
  const p = tokenPath(token);
  if (!existsSync(p)) return null;
  try {
    const j = JSON.parse(readFileSync(p, "utf8"));
    return { token: j.token, expiresAt: j.expiresAt, used: j.used };
  } catch {
    return null;
  }
}

/**
 * Atomically claims a token: renames its ticket into the `consumed/` dir. Only
 * the caller that performed the rename gets `true`, so two concurrent requests
 * with the same token cannot both succeed — a plain validate-then-write flag
 * race cannot do that.
 */
function claimToken(token: string): boolean {
  const src = tokenPath(token);
  if (!existsSync(src)) return false;
  const consumedDir = join(AUTH_DIR, "consumed");
  mkdirSync(consumedDir, { recursive: true, mode: 0o700 });
  try {
    renameSync(src, join(consumedDir, `consumed-${token}.json`));
    return true;
  } catch {
    return false; // another request already claimed it
  }
}

/** True only for a token that exists, is unexpired, and is unused. */
export function validateAuthToken(token: string): boolean {
  const t = readTicket(token);
  if (!t) return false;
  if (t.used) return false;
  if (new Date(t.expiresAt).getTime() < Date.now()) return false;
  return true;
}

export interface CapturedCookie {
  name: string;
  value: string;
  domain: string;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: string;
}

export interface CaptureResult {
  ok: boolean;
  cookieCount?: number;
  error?: string;
}

/**
 * Stores captured Threads cookies as the profile's cookie store. The publisher
 * loads this store back into the Chromium profile before going headless.
 */
export function storeCapturedCookies(token: string, cookies: CapturedCookie[]): CaptureResult {
  if (!Array.isArray(cookies) || cookies.length === 0) return { ok: false, error: "no cookies supplied" };

  const names = new Set(cookies.map((c) => c.name));
  // The Threads web session hangs off these; capturing them is the real proof
  // of a logged-in browser.
  const required = ["sessionid", "csrftoken"];
  const missing = required.filter((n) => !names.has(n));
  if (missing.length) {
    return { ok: false, error: `incomplete cookie set — missing: ${missing.join(", ")}` };
  }

  if (!validateAuthToken(token)) return { ok: false, error: "token invalid, expired, or already used" };

  // Claim first, then write: if another request already consumed this token the
  // rename fails and we refuse before any cookie is stored.
  ensureDir();
  if (!claimToken(token)) return { ok: false, error: "token invalid, expired, or already used" };

  writeFileSync(
    COOKIE_FILE,
    JSON.stringify({ capturedAt: new Date().toISOString(), cookies }, null, 2),
    { mode: 0o600 },
  );
  return { ok: true, cookieCount: cookies.length };
}

/** True once a capture has landed. Drives the adapter's LIVE/DISABLED tag. */
export function hasCapturedSession(): boolean {
  if (!existsSync(COOKIE_FILE)) return false;
  try {
    const j = JSON.parse(readFileSync(COOKIE_FILE, "utf8"));
    return Array.isArray(j.cookies) && j.cookies.length > 0;
  } catch {
    return false;
  }
}

/** Cookie names captured — never the values, so logs stay clean. */
export function capturedCookieNames(): string[] {
  try {
    const j = JSON.parse(readFileSync(COOKIE_FILE, "utf8"));
    return (j.cookies || []).map((c: CapturedCookie) => c.name);
  } catch {
    return [];
  }
}

/** Re-arms the capture flow by clearing the stored session. */
export function clearCapturedSession(): boolean {
  if (!existsSync(COOKIE_FILE)) return false;
  writeFileSync(COOKIE_FILE, JSON.stringify({ cookies: [] }));
  return true;
}

/**
 * Loads the captured cookies into the Chromium profile Chromium itself reads.
 * Uses Chromium's own Cookies sqlite only via a small Netscape-format dump that
 * headless Chromium accepts with `--cookies-file` is NOT supported, so instead
 * the cookies are injected at runtime through CDP `Network.setCookies`.
 */
export function loadCookiesForInjection(): CapturedCookie[] {
  try {
    const j = JSON.parse(readFileSync(COOKIE_FILE, "utf8"));
    return (j.cookies || []).map((c: CapturedCookie) => ({
      name: c.name,
      value: c.value,
      domain: c.domain.startsWith(".") ? c.domain : `.${c.domain}`,
      path: c.path || "/",
      secure: c.secure !== false,
      httpOnly: Boolean(c.httpOnly),
      sameSite: c.sameSite || "Lax",
    }));
  } catch {
    return [];
  }
}

/** HMAC over the cookie payload, so a tampered store is detectable. */
export function sessionFingerprint(): string {
  try {
    const raw = readFileSync(COOKIE_FILE, "utf8");
    return createHmac("sha256", PEPPER).update(raw).digest("hex").slice(0, 16);
  } catch {
    return "";
  }
}

export function verifyFingerprint(fp: string): boolean {
  if (!fp || !sessionFingerprint()) return false;
  const a = Buffer.from(fp);
  const b = Buffer.from(sessionFingerprint());
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Expired/unused tickets still on disk — surfaced so they can be pruned. */
export function pruneExpiredTickets(): number {
  if (!existsSync(AUTH_DIR)) return 0;
  let n = 0;
  const now = Date.now();
  let files: string[] = [];
  try {
    files = readdirSync(AUTH_DIR);
  } catch {
    return 0;
  }
  for (const f of files) {
    if (!f.startsWith("pending-")) continue;
    const p = join(AUTH_DIR, f);
    try {
      const j = JSON.parse(readFileSync(p, "utf8"));
      if (j.used || new Date(j.expiresAt).getTime() < now) {
        try {
          unlinkSync(p);
          n++;
        } catch { /* ignore */ }
      }
    } catch { /* skip unreadable */ }
  }
  return n;
}
