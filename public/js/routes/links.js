/* Route #/links — add link (single/bulk) + produk tersimpan.
 * Split out of the old monolith; behaviour preserved 1:1. */

import { api, esc, show, bindActions, card, field } from "../core.js";

const imgThumb = (l) =>
  l.image_url ? (l.image_url.startsWith("/api/") ? l.image_url : esc(l.image_url)) : "";

const imgPill = (l) => !l.image_url
  ? '<span class="pill noimg">no img</span>'
  : l.image_url.startsWith("/api/")
    ? '<span class="pill loc">lokal</span>'
    : '<span class="pill cdn">cdn</span>';

export const linksRoute = {
  html: () => `
    <h1>Link</h1>
    <div class="sub">Shopee link &rarr; auto-fetch produk &rarr; append bio sheet</div>
    <div class="stack">
      ${card("ADD LINK", `
        <label for="linksIn">Link Shopee (satu per baris, atau dipisah koma)</label>
        <textarea id="linksIn" placeholder="https://s.shopee.co.id/xxxxxxx"></textarea>
        <div class="row-auto">
          ${field("kategoriIn", "Kategori (opsional)", '<input id="kategoriIn" placeholder="Fasion / Elektronik / ..." />')}
          ${field("deskripsiIn", "Deskripsi untuk bio (opsional)", '<input id="deskripsiIn" placeholder="kosongkan = otomatis" />')}
        </div>
        <div class="btnrow" style="margin-top:12px">
          <button id="btnDry">Cek data (dry-run)</button>
          <button id="btnSave" class="primary">Simpan &amp; append ke sheet</button>
        </div>
        <div id="dryOut" style="margin-top:10px"></div>
        <pre class="out hidden" id="saveOut"></pre>
      `)}

      ${card("PRODUK TERSIMPAN", `
        <div class="btnrow" style="margin-bottom:8px">
          <button data-act="refresh-links">Refresh</button>
          <button data-act="to-konten">Buka Konten AI</button>
          <span class="lbl">Format gambar:</span>
          <select id="presetSel"></select>
        </div>
        <div class="table-wrap"><table id="linkTable"></table></div>
        <pre class="out hidden" id="rowOut"></pre>
      `)}
    </div>`,

  async mount(view) {
    const el = (s) => view.querySelector(s);

    // Preset picker: options come from the server so the label list stays in
    // one place (src/core/image-presets.ts).
    api("/api/image-presets").then((r) => {
      const sel = el("#presetSel");
      if (!sel || !r.body?.presets) return;
      sel.innerHTML = r.body.presets
        .map((p) => `<option value="${esc(p.id)}" ${p.id === r.body.default ? "selected" : ""}>${esc(p.label)}</option>`)
        .join("");
    }).catch(() => {});

    function parseLinks() {
      return el("#linksIn").value.split(/[\n,;\s]+/).map((s) => s.trim()).filter(Boolean);
    }

    function payload(withSheet) {
      const b = { links: parseLinks() };
      const k = el("#kategoriIn").value.trim();
      const d = el("#deskripsiIn").value.trim();
      if (k) b.kategori = k;
      if (d) b.deskripsi = d;
      if (!withSheet) b.dryRun = true;
      return b;
    }

    function dryResultHtml(r) {
      const bad = r.status === "rejected";
      const n = r.og_found ? "ok" : "gagal";
      return `<div class="res">
        ${r.image_url && r.image_verified ? `<img src="${esc(r.image_url)}" alt="" onerror="this.style.display='none'" />` : ""}
        <div class="body">
          <div class="pname">${esc(r.product || r.short_url)}</div>
          <div class="meta">${esc(r.short_url)}</div>
          <div class="meta">og=${n}${r.og_found ? "" : ' <span class="bad">— data produk tidak terbaca</span>'} &middot; gambar=${
            r.image_verified ? '<span class="ok2">ok, siap dipakai bio</span>' : '<span class="bad">gagal — tidak akan di-append ke sheet</span>'}</div>
          ${r.link_id ? `<div class="meta">sudah ada di DB (link_id ${esc(r.link_id)}) — simpan = update</div>` : ""}
          ${bad ? `<div class="bad">✗ ${esc(r.reason || "ditolak")}</div>` : ""}
        </div></div>`;
    }

    async function doDry() {
      const links = parseLinks();
      if (!links.length) return;
      const btn = el("#btnDry");
      btn.disabled = true; btn.textContent = "Mengecek…";
      el("#dryOut").innerHTML = `<div class="meta">fetch og + cek gambar…</div>`;
      try {
        const r = await api("/api/links", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...payload(false), dryRun: true }),
        });
        const res = r.body?.results || [];
        el("#dryOut").innerHTML =
          `<div class="meta" style="margin-bottom:6px">${res.filter((x) => x.status !== "rejected").length}/${res.length} siap${
            r.body?.dryRun ? " (dry-run, belum disimpan)" : ""}</div>` + res.map(dryResultHtml).join("");
      } catch (e) {
        el("#dryOut").innerHTML = `<span class="bad">gagal: ${esc(String(e))}</span>`;
      } finally {
        btn.disabled = false; btn.textContent = "Cek data (dry-run)";
      }
    }

    async function doSave() {
      const links = parseLinks();
      if (!links.length) return;
      const btn = el("#btnSave");
      btn.disabled = true; btn.textContent = "Menyimpan…";
      try {
        const r = await api("/api/links", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload(true)),
        });
        show(el("#saveOut"), r);
        loadLinks();
      } catch (e) {
        show(el("#saveOut"), { status: 0, body: { error: String(e) } });
      } finally {
        btn.disabled = false; btn.textContent = "Simpan & append ke sheet";
      }
    }

    function linkRows(links) {
      return links.map((l) => `<tr data-id="${l.id}" class="${l.image_url?.startsWith("/api/") ? "local" : ""}">
        <td class="thumb">${imgThumb(l) ? `<img src="${imgThumb(l)}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'pill noimg',textContent:'404'}))" />` : '<span class="pill noimg">—</span>'}</td>
        <td><a href="${esc(l.short_url)}" target="_blank" rel="noopener">${esc(l.product || l.short_url)}</a>
          <div class="meta">id ${l.id}${l.sheet_id != null ? ` &middot; sheet ${esc(l.sheet_id)}` : ""}${l.kategori ? ` &middot; ${esc(l.kategori)}` : ""}</div></td>
        <td>${imgPill(l)}</td>
        <td><div class="btnrow">
          <button data-act="konten" data-id="${l.id}">Konten</button>
          <button data-act="recreate" data-id="${l.id}">Recreate</button>
          <button data-act="bio" data-id="${l.id}">Bio</button>
          <button data-act="enrich" data-id="${l.id}">Enrich</button>
        </div></td></tr>`).join("");
    }

    async function loadLinks() {
      const table = el("#linkTable");
      let r;
      try { r = await api("/api/links"); } catch (e) {
        table.innerHTML = `<tr><td class="bad">gagal: ${esc(String(e))}</td></tr>`;
        return;
      }
      const links = r.body?.links || [];
      table.innerHTML = `<thead><tr><th></th><th>produk</th><th>gambar</th><th>aksi</th></tr></thead><tbody>${
        links.length ? linkRows(links) : `<tr><td colspan="4" class="empty">belum ada link</td></tr>`
      }</tbody>`;
      for (const b of table.querySelectorAll("button[data-act]")) b.onclick = () => rowAction(b);
    }

    async function rowAction(btn) {
      const act = btn.getAttribute("data-act");
      if (act === "konten") { location.hash = "#/konten"; return; }
      const id = Number(btn.getAttribute("data-id"));
      const out = el("#rowOut");
      const k = el("#kategoriIn").value.trim();
      const d = el("#deskripsiIn").value.trim();
      const body = { link_id: id };
      if (k) body.kategori = k;
      if (d) body.deskripsi = d;

      if (act === "recreate") {
        btn.disabled = true; btn.textContent = "Generating…";
        out.hidden = false; out.textContent = "recreate jalan (bisa 10–60s)…";
        try {
          const preset = el("#presetSel")?.value || "";
          const r = await api(`/api/links/${id}/recreate-image`, {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify(preset ? { preset } : {}),
          });
          show(out, r);
          const img = r.body?.image?.file;
          if (r.status === 200 && img) out.textContent += `\npratinjau: /api/images/${img}`;
          loadLinks();
        } finally { btn.disabled = false; btn.textContent = "Recreate"; }
        return;
      }
      if (act === "bio") {
        const r = await api("/api/bio/publish", {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
        });
        show(out, r); loadLinks(); return;
      }
      const r = await api(`/api/links/${id}/enrich`, { method: "POST", headers: { "content-type": "application/json" } });
      show(out, r); loadLinks();
    }

    bindActions(view, (btn) => {
      const act = btn.getAttribute("data-act");
      if (act === "konten") { location.hash = "#/konten"; return; }
      if (act === "refresh-links") return loadLinks();
      if (act === "to-konten") { location.hash = "#/konten"; }
    });

    el("#btnDry").onclick = doDry;
    el("#btnSave").onclick = doSave;
    loadLinks();
  },
};
