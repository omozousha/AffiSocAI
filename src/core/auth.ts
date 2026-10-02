/**
 * Session login for the web UI.
 *
 * Credentials live in env only (never in the repo, never in the bundle):
 *   AFFILIATE_WEB_USER          operator username (default "omozousha")
 *   AFFILIATE_WEB_PASS_SHA256   hex sha256(password) — plaintext never stored
 *   AFFILIATE_WEB_PASS          plaintext, only used by scripts/hash-web-pass.ts
 *                               to compute the hash; login does NOT read it.
 *   AFFILIATE_SESSION_SECRET    HMAC key for session cookies (random default
 *                               per boot; set in .env to survive restarts)
 *
 * A session cookie is HttpOnly + SameSite=Lax, 30 days. The UI never sees the
 * password. Mutating /api/ calls accept EITHER a valid session cookie OR the
 * x-api-token header (scripts keep working).
 */
import { createHmac, randomBytes, timingSafeEqual, createHash } from "node:crypto";

const USER = () => (process.env.AFFILIATE_WEB_USER || "omozousha").trim();
const PASS_HASH = () => (process.env.AFFILIATE_WEB_PASS_SHA256 || "").trim().toLowerCase();
const SECRET = process.env.AFFILIATE_SESSION_SECRET || randomBytes(32).toString("hex");
export const COOKIE_NAME = "affi_session";
const MAX_AGE = 30 * 24 * 3600;

function sign(payload: string): string {
  return createHmac("sha256", SECRET).update(payload).digest("base64url");
}

/** "u.<b64user>.<expiry>.<sig>" — stateless, verified by HMAC. */
export function makeSessionCookie(username: string): string {
  const u = Buffer.from(username, "utf8").toString("base64url");
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE;
  return `${u}.${exp}.${sign(`${u}.${exp}`)}`;
}

export function verifySessionCookie(raw: string | undefined): string | null {
  if (!raw) return null;
  const parts = raw.split(".");
  if (parts.length !== 3) return null;
  const [u, exp, sig] = parts;
  if (!/^\d+$/.test(exp) || Number(exp) < Math.floor(Date.now() / 1000)) return null;
  const want = sign(`${u}.${exp}`);
  const a = Buffer.from(sig);
  const b = Buffer.from(want);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    return Buffer.from(u, "base64url").toString("utf8");
  } catch {
    return null;
  }
}

export function sessionCookieHeader(value: string): string {
  return `${COOKIE_NAME}=${value}; Path=/; Max-Age=${MAX_AGE}; HttpOnly; SameSite=Lax`;
}

export function clearCookieHeader(): string {
  return `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`;
}

function equalHex(a: string, b: string): boolean {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Constant-time credential check. Returns the username on success. */
export function checkCredentials(username: string, password: string): string | null {
  const hash = createHash("sha256").update(password, "utf8").digest("hex");
  const okUser = equalHex(Buffer.from(username, "utf8").toString("hex"), Buffer.from(USER(), "utf8").toString("hex"));
  const okPass = PASS_HASH().length === 64 && equalHex(hash, PASS_HASH());
  return okUser && okPass ? USER() : null;
}

export function loginConfigured(): boolean {
  return PASS_HASH().length === 64;
}
