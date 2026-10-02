import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Operator API token. The backend guards every mutating /api/ call with
 * AFFILIATE_API_TOKEN (x-api-token header). The browser gets it once via a
 * prompt and keeps it in localStorage; a 401 on a mutating call re-asks.
 */
const TOKEN_KEY = "affisoc_api_token";

export function getApiToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) || "";
  } catch {
    return "";
  }
}

export function setApiToken(t: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, t.trim());
  } catch {
    /* private mode */
  }
}

function askToken(): string {
  const t = window.prompt("Masukkan token API (AFFILIATE_API_TOKEN dari .env server):", getApiToken()) || "";
  if (t) setApiToken(t);
  return t;
}

export async function api<T = unknown>(
  path: string,
  init?: RequestInit,
  _retried = false,
): Promise<{ status: number; body: T }> {
  const headers = new Headers(init?.headers || {});
  const token = getApiToken();
  if (token) headers.set("x-api-token", token);
  const r = await fetch(path, { ...init, headers });
  if (r.status === 401 && !_retried && (init?.method || "GET") !== "GET") {
    askToken();
    return api<T>(path, init, true);
  }
  let body: T;
  try {
    body = (await r.json()) as T;
  } catch {
    body = {} as T;
  }
  return { status: r.status, body };
}
