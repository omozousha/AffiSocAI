/* Shared front-end core: fetch wrapper, dom helpers, component builders.
 * Zero dependencies, ES modules. Imported by every route module. */

/**
 * One SSE connection for the whole tab, shared by the sidebar error badge and
 * the Logs route. Subscribers receive every new log row as it is written.
 * Opening one EventSource per route would leak a connection per navigation.
 */
const logFeed = {
  subs: new Set(),
  src: null,
  subscribe(fn) {
    if (!this.src && typeof EventSource !== "undefined") {
      this.src = new EventSource("/api/logs/stream");
      this.src.onmessage = (e) => {
        let row;
        try { row = JSON.parse(e.data); } catch { return; }
        for (const sub of this.subs) sub(row);
      };
    }
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  },
};

export { logFeed };

export const $ = (s) => document.querySelector(s);

export async function api(path, init) {
  const r = await fetch(path, init);
  let body = null;
  try { body = await r.json(); } catch { body = { raw: await r.text?.() }; }
  return { status: r.status, body };
}

export const on = (v) => (v ? "✅" : "—");

export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** Render an API response into a <pre class="out"> element. */
export function show(el, r) {
  el.hidden = false;
  el.textContent = `HTTP ${r.status}\n${JSON.stringify(r.body, null, 2)}`;
}

/** Re-bind every button carrying `data-act` inside root to handler. */
export function bindActions(root, handler) {
  for (const b of root.querySelectorAll("button[data-act]")) b.onclick = () => handler(b);
}

export const card = (title, inner) =>
  `<section class="card"><h2>${title}</h2>${inner}</section>`;

export const CLIP_LIMITS = { instagram: 2200, facebook: 60000, x: 280 };

/** Recurring status badge. */
export function tag(kind, label) {
  return `<span class="tag ${kind}">${esc(label)}</span>`;
}

/** Tag a link_id caption with its character limit. */
export function limitNote(len, platform) {
  const limit = CLIP_LIMITS[platform] ?? 99999;
  const over = len > limit ? `<span class="bad"> ⚠ over limit</span>` : "";
  const colour = len > limit ? "var(--bad)" : "var(--fg-mute)";
  return `<div class="meta" style="color:${colour}">${len} / ${limit} char${over}</div>`;
}

/** Shared grouped input used on the add-link form. */
export const field = (id, label, control, extra = "") =>
  `<div><label for="${id}">${label}</label>${control}${extra}</div>`;
