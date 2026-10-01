/**
 * Google Flow cookie session — keyless-style image backend via operator cookies.
 *
 * Flow: operator exports cookies JSON from their own logged-in Chrome
 * (flow.google.com + .google.com), uploads via POST /api/flow/cookies.
 * Server stores 0600 at ~/.affiliate-tools/flow-cookies.json (outside repo),
 * reuses the session for Nano Banana image generation.
 *
 * Cookie lifetime: Google SID-family ~180 days from export (observed
 * 2027-03-30 on the 2026-10-01 export), RTS short-lived (~hours). Status
 * endpoint reports the earliest expiry so the operator knows when to reimport.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const HOME = process.env.HOME || "/root";
const FLOW_DIR = join(HOME, ".affiliate-tools", "flow");
const COOKIE_FILE = join(FLOW_DIR, "flow-cookies.json");

export interface FlowCookie {
  name: string;
  value: string;
  domain: string;
  expirationDate?: number;
  path?: string;
  httpOnly?: boolean;
  secure?: boolean;
}

function ensureDir(): void {
  mkdirSync(FLOW_DIR, { recursive: true, mode: 0o700 });
}

/** Parse the operator-uploaded JSON: {url, cookies:[...]} or bare [...]. */
export function parseCookieUpload(body: unknown): { ok: true; cookies: FlowCookie[] } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "empty payload" };
  const b = body as Record<string, unknown>;
  const raw = Array.isArray(b) ? b : b.cookies;
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, error: "missing cookies array" };
  const cookies: FlowCookie[] = [];
  for (const c of raw) {
    if (!c || typeof c !== "object") continue;
    const cc = c as Record<string, unknown>;
    if (typeof cc.name !== "string" || typeof cc.value !== "string") continue;
    cookies.push({
      name: cc.name,
      value: cc.value,
      domain: typeof cc.domain === "string" ? cc.domain : ".google.com",
      expirationDate: typeof cc.expirationDate === "number" ? cc.expirationDate : undefined,
      path: typeof cc.path === "string" ? cc.path : "/",
      httpOnly: cc.httpOnly === true,
      secure: cc.secure === true,
    });
  }
  // Must carry the session backbone: SID + at least one PSID/SSID.
  const names = new Set(cookies.map((c) => c.name));
  if (!names.has("SID")) return { ok: false, error: "SID missing — export from a logged-in Chrome profile" };
  if (!names.has("__Secure-1PSID") && !names.has("__Secure-3PSID") && !names.has("SSID")) {
    return { ok: false, error: "no PSID/SSID — session cookies incomplete" };
  }
  return { ok: true, cookies };
}

export function saveFlowCookies(cookies: FlowCookie[]): { count: number; earliestExpiry: string | null } {
  ensureDir();
  writeFileSync(COOKIE_FILE, JSON.stringify({ saved_at: Date.now(), cookies }, null, 2), { mode: 0o600 });
  return { count: cookies.length, earliestExpiry: earliestExpiryOf(cookies) };
}

export function loadFlowCookies(): FlowCookie[] {
  if (!existsSync(COOKIE_FILE)) return [];
  try {
    const d = JSON.parse(readFileSync(COOKIE_FILE, "utf8"));
    return Array.isArray(d.cookies) ? d.cookies : [];
  } catch {
    return [];
  }
}

export function clearFlowCookies(): boolean {
  if (!existsSync(COOKIE_FILE)) return false;
  unlinkSync(COOKIE_FILE);
  return true;
}

function earliestExpiryOf(cookies: FlowCookie[]): string | null {
  // Exclude short-lived rotation tokens (RTS) — they expire in hours/days but
  // are not the session backbone. SID/PSID/OSID are what matter (~180 days).
  const SKIP = new Set(["__Secure-1PSIDRTS", "__Secure-3PSIDRTS"]);
  let min = Infinity;
  for (const c of cookies) {
    if (SKIP.has(c.name)) continue;
    if (typeof c.expirationDate === "number" && c.expirationDate < min) min = c.expirationDate;
  }
  if (!isFinite(min)) return null;
  return new Date(min * 1000).toISOString().slice(0, 10);
}

/** Session status for the UI: live flag + earliest cookie expiry + days left. */
export function flowStatus(): {
  live: boolean;
  count: number;
  earliestExpiry: string | null;
  daysLeft: number | null;
  account: string | null;
} {
  const cookies = loadFlowCookies();
  if (cookies.length === 0) return { live: false, count: 0, earliestExpiry: null, daysLeft: null, account: null };
  const earliest = earliestExpiryOf(cookies);
  let daysLeft: number | null = null;
  if (earliest) {
    daysLeft = Math.round((new Date(earliest).getTime() - Date.now()) / 86_400_000);
  }
  return { live: (daysLeft ?? 1) > 0, count: cookies.length, earliestExpiry: earliest, daysLeft, account: null };
}

/** Cookie header for flow.google.com + .google.com requests. */
export function flowCookieHeader(): string | null {
  const cookies = loadFlowCookies();
  if (cookies.length === 0) return null;
  return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
}
