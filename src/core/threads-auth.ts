/**
 * Threads auth ticket system — single-use auth links for operator-side cookie capture.
 *
 * Flow:
 *   1. POST /api/providers/threads/auth-link → {token, url, expiresAt}
 *   2. Operator opens url in browser already logged into threads.com
 *   3. Capture page reads sessionid + csrftoken cookies, POSTs back
 *   4. Server validates + claims ticket + stores cookies
 *
 * Claim-by-rename to avoid races: validate payload first, then rename ticket
 * from pending/ to consumed/. Replay = 422.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const HOME = process.env.HOME || "/root";
const AUTH_DIR = join(HOME, ".affiliate-tools", "chromium-threads", "auth");
const COOKIE_FILE = join(AUTH_DIR, "threads-cookie.json");
const TICKET_TTL_MS = 15 * 60 * 1000; // 15 minutes

export interface AuthTicket {
  token: string;
  created_at: number;
  expires_at: number;
}

function ensureDir(): void {
  mkdirSync(AUTH_DIR, { recursive: true, mode: 0o700 });
  const consumed = join(AUTH_DIR, "consumed");
  mkdirSync(consumed, { recursive: true, mode: 0o700 });
}

function ticketPath(token: string): string {
  return join(AUTH_DIR, `pending-${token}.json`);
}

function consumedPath(token: string): string {
  return join(AUTH_DIR, "consumed", `${token}.json`);
}

export function createTicket(): AuthTicket {
  ensureDir();
  const token = Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const now = Date.now();
  const ticket: AuthTicket = {
    token,
    created_at: now,
    expires_at: now + TICKET_TTL_MS,
  };
  writeFileSync(ticketPath(token), JSON.stringify(ticket, null, 2), { mode: 0o600 });
  return ticket;
}

export function claimTicket(token: string): { ok: boolean; error?: string } {
  ensureDir();
  const src = ticketPath(token);
  const dst = consumedPath(token);

  // Already consumed?
  if (existsSync(dst)) {
    return { ok: false, error: "ticket already used" };
  }

  // Not found or expired?
  if (!existsSync(src)) {
    return { ok: false, error: "ticket not found" };
  }
  let ticket: AuthTicket;
  try {
    ticket = JSON.parse(readFileSync(src, "utf8"));
  } catch {
    return { ok: false, error: "invalid ticket" };
  }
  if (Date.now() > ticket.expires_at) {
    unlinkSync(src);
    return { ok: false, error: "ticket expired" };
  }

  // Claim by rename — atomic on same FS, avoids races
  try {
    renameSync(src, dst);
  } catch (e) {
    return { ok: false, error: `claim failed: ${e instanceof Error ? e.message : e}` };
  }
  return { ok: true };
}

export function validateCapturePayload(body: unknown): { ok: boolean; cookies?: Array<{ name: string; value: string }>; error?: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "empty payload" };
  const b = body as Record<string, unknown>;
  const token = typeof b.token === "string" ? b.token.trim() : "";
  if (!token) return { ok: false, error: "missing token" };
  const cookies = b.cookies;
  if (!Array.isArray(cookies) || cookies.length === 0) {
    return { ok: false, error: "missing cookies array" };
  }
  // Must have at least sessionid + csrftoken
  const names = cookies.map((c: unknown) => {
    if (typeof c !== "object" || !c) return "";
    const cc = c as Record<string, unknown>;
    return typeof cc.name === "string" ? cc.name : "";
  });
  const hasSession = names.some((n: string) => n === "sessionid");
  const hasCsrf = names.some((n: string) => n === "csrftoken");
  if (!hasSession || !hasCsrf) {
    return { ok: false, error: `missing required cookies; got: ${names.join(",")}` };
  }
  const clean = cookies
    .filter((c: unknown): c is { name: string; value: string } => typeof c === "object" && c !== null && typeof (c as Record<string, unknown>).name === "string" && typeof (c as Record<string, unknown>).value === "string")
    .map((c) => ({ name: c.name, value: c.value }));
  return { ok: true, cookies: clean };
}

export function storeCapturedCookies(token: string, cookies: Array<{ name: string; value: string }>): void {
  ensureDir();
  const claim = claimTicket(token);
  if (!claim.ok) throw new Error(claim.error);

  writeFileSync(
    COOKIE_FILE,
    JSON.stringify({ cookies, captured_at: new Date().toISOString(), source: "threads-auth-capture" }, null, 2),
    { mode: 0o600 }
  );
}

export function loadCookies(): Array<{ name: string; value: string }> {
  if (!existsSync(COOKIE_FILE)) return [];
  try {
    const data = JSON.parse(readFileSync(COOKIE_FILE, "utf8"));
    return Array.isArray(data?.cookies) ? data.cookies : [];
  } catch {
    return [];
  }
}

export function clearCookies(): boolean {
  if (!existsSync(COOKIE_FILE)) return false;
  unlinkSync(COOKIE_FILE);
  return true;
}

export function authStatus(): { live: boolean; cookieCount: number; cookies: string[] } {
  const cookies = loadCookies();
  return {
    live: cookies.length > 0,
    cookieCount: cookies.length,
    cookies: cookies.map((c) => c.name),
  };
}
