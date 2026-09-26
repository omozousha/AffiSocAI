/* Route #/logs — activity + error feed.
 * Pairs with GET /api/logs (snapshot) and /api/logs/stream (SSE live tail). */

import { api, esc, card, logFeed } from "../core.js";

const LEVELS = ["info", "warn", "error"];

export const logsRoute = {
  html: () => `
    <h1>Logs</h1>
    <div class="sub">Aktivitas request &amp; error server. Live tail via SSE.</div>
    <div class="stack">
      ${card("STATS", `<div id="statRow" class="stats">…</div>`)}
      ${card("FILTER", `
        <div class="row">
          <div>
            <label class="lbl">Level</label>
            <div class="btnrow" id="levelFilter">
              <button data-level="" class="chip active">semua</button>
              ${LEVELS.map((l) => `<button data-level="${l}" class="chip">${l}</button>`).join("")}
            </div>
          </div>
          <div>
            <label class="lbl">Cari</label>
            <div class="btnrow">
              <input id="q" placeholder="path / pesan / tool" />
              <button id="search">Cari</button>
              <button id="clear">Reset</button>
            </div>
          </div>
        </div>`)}
      ${card("AKTIVITAS", `
        <div id="live" class="live"><span class="dot"></span> live</div>
        <table class="logs"><thead><tr>
          <th>#</th><th>waktu</th><th>level</th><th>event</th><th>src</th>
          <th>method</th><th>path</th><th>status</th><th>ms</th><th>pesan</th>
        </tr></thead><tbody id="logRows"><tr><td colspan="10" class="muted">memuat…</td></tr></tbody></table>
        <div class="btnrow"><button id="more">Muat lebih banyak</button></div>`)}
    </div>`,

  mount(view) {
    const q = { level: "", search: "", limit: 200, offset: 0 };
    const rows = [];
    let unsub = null;
    let appStats = { total: 0, error: 0, warn: 0, info: 0, last_hour: 0 };

    const rowHtml = (r) => {
      const meta = r.meta && typeof r.meta === "object" ? r.meta : {};
      const tool = meta.tool ? ` <span class="tag">${esc(meta.tool)}</span>` : "";
      const query = meta.query ? ` <span class="muted">${esc(meta.query)}</span>` : "";
      return `<tr class="${r.level}">
        <td class="muted">${r.id}</td>
        <td class="nowrap">${esc((r.ts || "").replace(" ", " ").slice(0, 19))}</td>
        <td><span class="lvl ${r.level}">${r.level}</span></td>
        <td>${esc(r.event)}</td>
        <td class="muted">${esc(r.source)}</td>
        <td>${esc(r.method || "—")}</td>
        <td class="path" title="${esc(r.path || "")}">${esc(r.path || "—")}${tool}${query}</td>
        <td><span class="st ${r.status >= 400 ? "bad" : r.status >= 300 ? "warn" : "ok"}">${r.status ?? "—"}</span></td>
        <td class="muted nowrap">${r.duration_ms != null ? `${r.duration_ms}ms` : "—"}</td>
        <td class="msg" title="${esc(r.message || "")}">${esc((r.message || "").slice(0, 160))}</td>
      </tr>`;
    };

    function paint() {
      const body = view.querySelector("#logRows");
      if (!rows.length) body.innerHTML = `<tr><td colspan="10" class="muted">tidak ada log.</td></tr>`;
      else body.innerHTML = rows.map(rowHtml).join("");
    }

    function paintStats() {
      view.querySelector("#statRow").innerHTML = rows.length
        ? `<span class="stat"><b id="stTotal">${appStats.total}</b> total</span>
           <span class="stat bad"><b id="stErr">${appStats.error}</b> error</span>
           <span class="stat warn"><b id="stWarn">${appStats.warn}</b> warn</span>
           <span class="stat ok"><b id="stInfo">${appStats.info}</b> info</span>
           <span class="stat"><b id="stHour">${appStats.last_hour}</b> 1 jam terakhir</span>`
        : "";
    }

    async function load(reset) {
      if (reset) { q.offset = 0; rows.length = 0; }
      const params = new URLSearchParams({ limit: String(q.limit), offset: String(q.offset) });
      if (q.level) params.set("level", q.level);
      if (q.search) params.set("search", q.search);
      const r = await api(`/api/logs?${params}`);
      const fresh = (r.body.rows || []).slice();
      appStats = r.body.stats || appStats;
      if (reset) rows.push(...fresh); else rows.push(...fresh);
      q.offset += fresh.length;
      paint();
      paintStats();
      view.querySelector("#more").disabled = !r.body.next_offset;
    }

    view.querySelectorAll("#levelFilter .chip").forEach((b) => {
      b.onclick = () => {
        view.querySelectorAll("#levelFilter .chip").forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
        q.level = b.getAttribute("data-level");
        load(true);
      };
    });

    view.querySelector("#search").onclick = () => { q.search = view.querySelector("#q").value.trim(); load(true); };
    view.querySelector("#q").onkeydown = (e) => { if (e.key === "Enter") view.querySelector("#search").onclick(); };
    view.querySelector("#clear").onclick = () => {
      view.querySelector("#q").value = ""; q.search = "";
      q.level = "";
      view.querySelectorAll("#levelFilter .chip").forEach((x) => x.classList.toggle("active", !x.getAttribute("data-level")));
      load(true);
    };
    view.querySelector("#more").onclick = () => load(false);

    load(true);

    // live tail — shared feed, unsubscribed when the route is left
    const live = view.querySelector("#live");
    unsub = logFeed.subscribe((r) => {
      if (q.level && r.level !== q.level) return;
      if (q.search) {
        const hay = `${r.path || ""}${r.message || ""}${r.event || ""}${JSON.stringify(r.meta || {})}`.toLowerCase();
        if (!hay.includes(q.search.toLowerCase())) return;
      }
      rows.unshift(r);
      if (rows.length > 500) rows.length = 500;
      appStats = { ...appStats, total: appStats.total + 1, last_hour: appStats.last_hour + 1 };
      if (r.level === "error") appStats.error += 1;
      if (r.level === "warn") appStats.warn += 1;
      paint();
      paintStats();
      if (live) live.innerHTML = `<span class="dot"></span> live`;
    });

    view.cleanup = () => { if (unsub) unsub(); };
  },
};
