import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Operator API token. The backend guards every mutating /api/ call with
 * AFFILIATE_API_TOKEN (x-api-token header). The browser gets it once via a
 * DOM dialog and keeps it in localStorage; a 401 on a mutating call re-asks.
 * NOTE: no window.prompt — Chrome for Android does not implement it (returns
 * null, dialog silently never appears). This modal is real DOM, works on
 * mobile, and the input accepts long-press paste.
 */
const TOKEN_KEY = "***";

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

export function askToken(): Promise<string> {
  return new Promise((resolve) => {
    const wrap = document.createElement("div");
    wrap.style.cssText =
      "position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;z-index:99999;padding:16px";
    wrap.innerHTML = [
      '<div style="background:#111827;color:#e5e7eb;padding:16px;border-radius:12px;width:min(92vw,360px);font:14px system-ui">',
      '<div style="font-weight:600;margin-bottom:4px">Token API</div>',
      '<div style="font-size:12px;color:#9ca3af;margin-bottom:10px">Nilai AFFILIATE_API_TOKEN dari .env server — sekali saja, tersimpan di browser ini.</div>',
      '<input id="affi-tok" type="text" autocapitalize="none" autocorrect="off" autocomplete="off" spellcheck="false" placeholder="tempel token di sini" style="width:100%;box-sizing:border-box;padding:10px;border-radius:8px;border:1px solid #374151;background:#0b1220;color:#e5e7eb;font:14px monospace">',
      '<div style="display:flex;gap:8px;margin-top:12px;justify-content:flex-end">',
      '<button id="affi-tok-cancel" style="padding:8px 14px;border-radius:8px;border:1px solid #374151;background:transparent;color:#e5e7eb">Batal</button>',
      '<button id="affi-tok-save" style="padding:8px 14px;border-radius:8px;border:0;background:#22c55e;color:#04110a;font-weight:700">Simpan</button>',
      "</div></div>",
    ].join("");
    const input = wrap.querySelector("#affi-tok") as HTMLInputElement;
    input.value = getApiToken();
    const done = (v: string) => {
      wrap.remove();
      if (v) setApiToken(v);
      resolve(v);
    };
    wrap.querySelector("#affi-tok-save")!.addEventListener("click", () => done(input.value.trim()));
    wrap.querySelector("#affi-tok-cancel")!.addEventListener("click", () => done(""));
    wrap.addEventListener("click", (e) => {
      if (e.target === wrap) done("");
    });
    document.body.appendChild(wrap);
    setTimeout(() => input.focus(), 60);
  });
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
    const t = await askToken();
    if (t) {
      headers.set("x-api-token", t);
      const r2 = await fetch(path, { ...init, headers });
      let b2: T;
      try {
        b2 = (await r2.json()) as T;
      } catch {
        b2 = {} as T;
      }
      return { status: r2.status, body: b2 };
    }
  }
  let body: T;
  try {
    body = (await r.json()) as T;
  } catch {
    body = {} as T;
  }
  return { status: r.status, body };
}
