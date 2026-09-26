/* Route #/konten — generate caption multi-platform + draft tersimpan.
 * Behaviour preserved 1:1 from the monolith app.js. */

import { api, esc, show, bindActions, card, limitNote, field } from "../core.js";

let kontenCache = null;

export const kontenRoute = {
  html: () => `
    <h1>Konten AI</h1>
    <div class="sub">Generate caption per platform &rarr; simpan draft (link tetap di bio)</div>
    <div class="stack">
      ${card("GENERATE", `
        <div class="row-auto">
          ${field("kontenLinkId", "Link ID (dari tabel Link)", '<input id="kontenLinkId" placeholder="15" inputmode="numeric" />')}
          <div>
            <label for="kontenPlatforms">Platform</label>
            <select id="kontenPlatforms" multiple size="3">
              <option value="instagram" selected>instagram</option>
              <option value="facebook" selected>facebook</option>
              <option value="x" selected>x</option>
            </select>
          </div>
          <div>
            <label for="kontenMode">Mode caption</label>
            <select id="kontenMode">
              <option value="mystery" selected>Mystery (nama produk disembunyikan)</option>
              <option value="direct">Direct (nama produk disebut)</option>
            </select>
          </div>
          <div>
            <label>&nbsp;</label>
            <div class="btnrow">
              <button id="btnGenKonten" class="primary">Generate caption</button>
              <button id="btnSaveKonten" data-act="save-konten">Simpan semua draft</button>
            </div>
          </div>
        </div>
        <div class="note">Mystery: nama produk tidak muncul di caption, link tetap di bio. Direct menyebut nama — klaim harga/ongkir tetap tidak dibuat otomatis.</div>
        <div id="kontenOut" style="margin-top:10px"></div>
        <pre class="out hidden" id="kontenLog"></pre>
      `)}

      ${card("KONTEN TERSIMPAN", `
        <div class="btnrow" style="margin-bottom:8px">
          <button data-act="refresh-konten">Refresh</button>
        </div>
        <div id="kontenList"></div>
      `)}
    </div>`,

  async mount(view) {
    const el = (s) => view.querySelector(s);
    const Platforms = () => [...el("#kontenPlatforms").selectedOptions].map((o) => o.value);

    async function doGenKonten() {
      const linkId = Number(el("#kontenLinkId").value);
      const out = el("#kontenOut");
      if (!linkId) { out.innerHTML = `<div class="bad">isikan Link ID dulu</div>`; return; }
      const mode = el("#kontenMode").value;
      const r = await api(mode === "mystery" ? "/api/content/mystery" : "/api/content/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ link_id: linkId, platforms: Platforms() }),
      });
      kontenCache = r.body;
      out.innerHTML = (r.body.drafts || []).map(draftHtml).join("");
      for (const b of out.querySelectorAll("button[data-konten]"))
        b.onclick = () => saveOneKonten(Number(b.dataset.konten));
    }

    function draftHtml(d, i) {
      const media = d.media_url
        ? `<img src="${esc(d.media_url)}" alt="" />`
        : `<div style="width:64px;height:64px;border-radius:4px;background:#22262d;flex:0 0 auto"></div>`;
      return `<div class="res">
        ${media}
        <div class="body">
          <div class="pname">${esc(d.platform)} <span class="pill ${d.media_url ? "cdn" : "noimg"}">${esc(d.kind)}</span></div>
          <textarea data-kbody="${i}" style="margin-top:6px">${esc(d.body)}</textarea>
          ${limitNote(d.body.length, d.platform)}
          <div class="meta">${d.needsMedia ? "butuh gambar" : "text saja"} &middot; link di bio</div>
          <div class="btnrow" style="margin-top:6px">
            <button data-konten="${i}" class="primary">Simpan draft ini</button>
          </div>
        </div>
      </div>`;
    }

    async function submitDraft(i, kindOverride) {
      const linkId = Number(el("#kontenLinkId").value);
      const drafts = kontenCache?.drafts || [];
      const d = drafts[i];
      if (!d) return null;
      const ta = el(`[data-kbody="${i}"]`);
      const body = ta ? ta.value : d.body;
      const r = await api("/api/content", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          link_id: linkId,
          platform: d.platform,
          kind: kindOverride || (body === d.body ? d.kind : "text"),
          body,
          media_url: d.media_url,
        }),
      });
      return r;
    }

    async function saveOneKonten(i) {
      const r = await submitDraft(i);
      if (r) show(el("#kontenLog"), r);
      loadKonten();
    }

    async function doSaveKonten() {
      const drafts = kontenCache?.drafts || [];
      if (!drafts.length) return;
      const out = [];
      for (let i = 0; i < drafts.length; i++) {
        const r = await submitDraft(i);
        if (r) out.push(r.body);
      }
      const log = el("#kontenLog");
      log.hidden = false;
      log.textContent = out.map((b) => `HTTP 201\n${JSON.stringify(b, null, 2)}`).join("\n\n");
      loadKonten();
    }

    async function loadKonten() {
      const list = el("#kontenList");
      const r = await api("/api/content");
      const rows = r.body.content || [];
      if (!rows.length) { list.innerHTML = `<div class="empty">belum ada konten tersimpan</div>`; return; }
      // API returns newest-first; keep that order so the latest draft is first.
      list.innerHTML = rows.map((c) => `<div class="res" style="align-items:flex-start">
        <div class="body">
          <div class="pname">${esc(c.platform)} <span class="pill ${c.status === "draft" ? "schema" : "ok"}">${esc(c.status)}</span>
            <span class="pill cdn">link ${c.link_id}</span></div>
          <div class="meta" style="white-space:pre-wrap;margin-top:4px">${esc(c.body.slice(0, 160))}${c.body.length > 160 ? "…" : ""}</div>
        </div>
      </div>`).join("");
    }

    bindActions(view, (btn) => {
      if (btn.getAttribute("data-act") === "refresh-konten") loadKonten();
    });

    el("#btnGenKonten").onclick = doGenKonten;
    view.querySelector('[data-act="save-konten"]').onclick = doSaveKonten;
    loadKonten();
  },
};
