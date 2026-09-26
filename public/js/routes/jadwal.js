/* Route #/jadwal — posting schedule (3 slots/day) + trend of what is posting.
 *
 * Read-mostly: the only writes are "run this slot now", pause/resume, and
 * editing slot times. Every mutation is followed by a fresh GET, never an
 * optimistic update, because a slot can also be claimed by the server's own
 * tick loop between the click and the response. */

import { api, esc, card } from "../core.js";

const STATUS_TAG = {
  published: ["st ok", "terbit"],
  pending: ["st warn", "menunggu"],
  claimed: ["st warn", "diproses"],
  failed: ["st bad", "gagal"],
  skipped: ["st", "dilewati"],
};

/**
 * DB stamps are UTC ("YYYY-MM-DD HH:MM:SS"); humans read WIB (UTC+7).
 *
 * `Date.UTC(...)` takes NUMBERS, so it is not subject to the legacy
 * "YYYY-MM-DD HH:MM:SS" string parsing that some engines read as local time
 * (which silently doubles the offset). The +WIB shift is applied in
 * milliseconds and every field is then read back with a UTC getter — no local
 * getter anywhere, so the output cannot depend on the browser's timezone.
 */
const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

function wib(stamp) {
  if (!stamp) return "—";
  const [datePart, timePart = "00:00:00"] = stamp.trim().split(" ");
  const [y, mo, d] = datePart.split("-").map(Number);
  const [h, mi] = timePart.split(":").map(Number);

  const t = Date.UTC(y, mo - 1, d, h, mi) + WIB_OFFSET_MS;
  const dt = new Date(t);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(dt.getUTCDate())}/${p(dt.getUTCMonth() + 1)} ${p(dt.getUTCHours())}:${p(dt.getUTCMinutes())}`;
}

export const jadwalRoute = {
  html: () => `
    <h1>Jadwal</h1>
    <div class="sub">Auto-posting 3 slot per hari · <span id="schedDot" class="dot"></span> <span id="schedState">…</span></div>
    <div class="stack">
      ${card("STATUS", `<div id="headRow" class="stats">memuat…</div>`)}
      ${card("PLATFORM", `<div id="platRow" class="stats">memuat…</div>`)}
      ${card("JAM POSTING", `
        <div class="row">
          <div id="timeChips" class="btnrow">…</div>
          <div class="btnrow">
            <span class="muted">Ubuh jam (HH:MM, dipisah koma)</span>
            <input id="newTimes" size="22" placeholder="09:00,13:00,19:00" />
            <button id="saveTimes">Simpan</button>
          </div>
        </div>
        <div class="note">Waktu WIB. Slot muncul otomatis 2 hari ke depan; slot yang sudah terbit tidak diubah.</div>`)}
      ${card("SLOT", `
        <div class="btnrow">
          <button id="refresh">Muat ulang</button>
          <button id="pause">Jeda</button>
        </div>
        <table class="logs"><thead><tr>
          <th>#</th><th>tanggal</th><th>jam</th><th>status</th><th>link</th><th>platform</th><th>post id</th><th>aksi</th>
        </tr></thead><tbody id="slotRows"><tr><td colspan="8" class="muted">memuat…</td></tr></tbody></table>`)}
      ${card("TREN 7 HARI", `
        <div id="trendRow" class="stats">memuat…</div>
        <div class="row">
          <div><h3>Per jam (WIB)</h3><div id="trendHour" class="bars">…</div></div>
          <div><h3>Produk terbanyak diposting</h3><ul id="trendLinks" class="plain">…</ul></div>
        </div>
        <div class="note">Data berasal dari slot yang sudah benar-benar terbit — bukan estimasi. Jumlah masih kecil, jadi ini laporan rotasi, bukan ramalan jam terbaik.</div>`)}
    </div>`,

  mount(view) {
    const slotRows = view.querySelector("#slotRows");
    const say = (el, text) => (view.querySelector(el).textContent = text);

    function rowHtml(s) {
      const [cls, label] = STATUS_TAG[s.status] || ["st", s.status];
      const act =
        s.status === "published"
          ? `<span class="muted">—</span>`
          : `<button data-run="${s.id}" class="small">Jalankan</button>`;
      return `<tr>
        <td class="muted">${s.id}</td>
        <td class="nowrap">${esc(s.slot_date)}</td>
        <td class="nowrap">${wib(s.scheduled_for)}</td>
        <td><span class="${cls}">${label}</span></td>
        <td class="muted">${s.link_id ?? "—"}</td>
        <td class="muted">${esc(s.platform || "—")}</td>
        <td class="path" title="${esc(s.error || "")}">${esc(s.post_id || (s.error ? "⚠" : "—"))}</td>
        <td>${act}</td>
      </tr>`;
    }

    async function load() {
      const [sched, health] = await Promise.all([
        api("/api/schedule?window=7"),
        api("/api/schedule/health"),
      ]);
      const { status: st, slots, trend } = sched.body;

      view.querySelector("#schedState").textContent = health.body.ok
        ? `aktif · berikutnya ${wib(st.next && st.next.scheduled_for)}`
        : st.enabled
          ? "aktif, tapi tidak ada platform siap"
          : "dijeda";
      view.querySelector("#schedDot").classList.add(health.ok ? "on" : "bad");

      view.querySelector("#headRow").innerHTML = `
        <span class="stat"><b>${trend.published}</b> terbit (7h)</span>
        <span class="stat bad"><b>${trend.failed}</b> gagal</span>
        <span class="stat"><b>${trend.content_queue}</b> konten siap</span>
        <span class="stat"><b>${st.today.published}</b> hari ini</span>`;

      view.querySelector("#platRow").innerHTML = st.platforms
        .map(
          (p) =>
            `<span class="stat ${p.ready ? "" : "bad"}"><b>${esc(p.slug)}</b> ${p.ready ? "siap" : "tidak siap"}</span>`,
        )
        .join("");

      view.querySelector("#timeChips").innerHTML = st.slot_times
        .map((t) => `<span class="chip">${esc(t)}</span>`)
        .join("");
      view.querySelector("#newTimes").value = st.slot_times.join(",");
      view.querySelector("#pause").textContent = st.enabled ? "Jeda" : "Lanjutkan";

      slotRows.innerHTML = slots.length
        ? slots.map(rowHtml).join("")
        : `<tr><td colspan="8" class="muted">belum ada slot.</td></tr>`;

      const byHour = Object.entries(trend.by_hour).sort((a, b) => b[1] - a[1]);
      const top = Math.max(1, ...byHour.map(([, n]) => n), 0);
      view.querySelector("#trendHour").innerHTML = byHour.length
        ? byHour
            .map(
              ([h, n]) =>
                `<div class="bar"><span class="barlbl">${esc(((Number(h) + 7) % 24) + ":00")}</span>
                 <span class="barfill" style="width:${Math.round((n / top) * 100)}%"></span><b>${n}</b></div>`,
            )
            .join("")
        : `<span class="muted">belum ada posting.</span>`;
      view.querySelector("#trendLinks").innerHTML = trend.top_links.length
        ? trend.top_links
            .map((l) => `<li>${esc(l.title)} <span class="muted">×${l.count}</span></li>`)
            .join("")
        : `<li class="muted">belum ada posting.</li>`;
    }

    view.querySelector("#refresh").addEventListener("click", load);

    view.querySelector("#pause").addEventListener("click", async () => {
      const st = (await api("/api/schedule?window=7")).body.status;
      await api("/api/schedule/config", {
        method: "POST",
        body: JSON.stringify({ enabled: !st.enabled }),
      });
      await load();
    });

    view.querySelector("#saveTimes").addEventListener("click", async () => {
      const raw = view.querySelector("#newTimes").value;
      const r = await fetch("/api/schedule/config", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slot_times: raw }),
      });
      const body = await r.json();
      if (!r.ok) view.querySelector("#schedState").textContent = body.error || "gagal simpan";
      await load();
    });

    // Event delegation: the table is re-rendered on every poll, so per-row
    // listeners would be lost. One listener on the tbody survives.
    view.querySelector("#slotRows").addEventListener("click", async (ev) => {
      const btn = ev.target.closest("button[data-run]");
      if (!btn) return;
      btn.disabled = true;
      btn.textContent = "…";
      try {
        await fetch("/api/schedule/run", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ slot_id: Number(btn.dataset.run) }),
        });
      } catch {
        /* the reload below shows the stored outcome, which is the truth */
      }
      await load();
    });

    load();
    // 20s poll: short enough that a slot the tick loop just published shows
    // up before the operator reloads the page by hand.
    const t = setInterval(load, 20_000);
    view.cleanup = () => clearInterval(t);
  },
};
