import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * API fetch for the logged-in UI. The operator session is an HttpOnly cookie
 * (set by POST /api/login) — the client never touches the token again. A 401
 * means the cookie expired: reload, the App gate shows the login form.
 * x-api-token (AFFILIATE_API_TOKEN) remains for scripts/curl.
 */
export async function api<T = unknown>(
  path: string,
  init?: RequestInit,
): Promise<{ status: number; body: T }> {
  const r = await fetch(path, init);
  if (r.status === 401) {
    window.location.reload();
    return { status: 401, body: {} as T };
  }
  let body: T;
  try {
    body = (await r.json()) as T;
  } catch {
    body = {} as T;
  }
  return { status: r.status, body };
}
