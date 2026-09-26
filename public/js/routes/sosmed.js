/* Route #/sosmed — composer + provider controls.
 * Behaviour preserved 1:1 from the monolith app.js. */

import { api, esc, on, show, bindActions, card, field } from "../core.js";

export const sosmedRoute = {
  html: () => `
    <h1>Sosmed</h1>
    <div class="sub">Composer &amp; status provider. IG/FB link tetap di bio.</div>
    <div class="stack">
      ${card("COMPOSER", `
        <div class="row">
          ${field("text", "Caption / text", '<textarea id="text">test post from affiliate-tools</textarea>')}
          <div>
            ${field("mediaUrl", "Media URL (must be directly fetchable by the platform)", '<input id="mediaUrl" placeholder="https://example.com/image.jpg" />')}
            ${field("mediaKind", "Media kind", `<select id="mediaKind">
                <option value="image">image</option>
                <option value="video">video</option>
                <option value="carousel">carousel</option>
              </select>`)}
          </div>
        </div>
      `)}
      <section class="card">
        <h2>PROVIDER</h2>
        <div class="btnrow" style="margin-bottom:8px">
          <button data-act="run-check">Cek koneksi IG</button>
        </div>
        <div id="providers" class="stack"></div>
      </section>
    </div>`,

  async mount(view) {
    const el = (s) => view.querySelector(s);

    function composerBody() {
      return {
        text: el("#text").value || "test post from affiliate-tools",
        mediaUrl: el("#mediaUrl").value || undefined,
        mediaKind: el("#mediaKind").value || "image",
      };
    }

    function providerRows(p) {
      const c = p.capabilities;
      const statusTag =
        p.status === "VERIFIED-EXECUTED" ? '<span class="tag ok">LIVE</span>'
        : p.status === "VERIFIED-VIA-SCHEMA" ? '<span class="tag schema">SCHEMA</span>'
        : '<span class="tag off">DISABLED</span>';
      const blocked = p.blockedReason ? `<div class="why">${p.blockedReason}</div>` : "";
      const ops = ["textPost", "imagePost", "videoPost", "carouselPost", "scheduledPost", "analytics"]
        .map((k) => `${k}=${on(c[k])}`).join(" ");
      const connectBtn =
        p.slug === "threads"
          ? `<button data-act="threads-login">Login Threads</button>
             <button data-act="threads-session">Cek sesi</button>`
          : "";
      return `<div class="provider" data-slug="${p.slug}">
        <div class="head"><h3>${p.displayName}</h3>${statusTag}</div>
        <div class="ops">${ops}</div>${blocked}
        ${connectBtn}
        <button data-act="account" data-slug="${p.slug}" ${p.status !== "VERIFIED-EXECUTED" ? "disabled" : ""}>Account</button>
        ${p.status === "VERIFIED-EXECUTED" ? `<button data-act="publish" data-slug="${p.slug}">Publish test</button>` : ""}
        <button data-act="validate" data-slug="${p.slug}">Validate</button>
        <pre class="out hidden"></pre>
      </div>`;
    }

    async function handle(btn) {
      const row = btn.closest(".provider");
      const out = row.querySelector(".out");
      const slug = btn.getAttribute("data-slug");
      const act = btn.getAttribute("data-act");

      // Threads-only actions: they are not provider-crud routes.
      if (act === "threads-login" || act === "threads-session") {
        out.classList.remove("hidden");
        out.textContent = act === "threads-login"
          ? "membuka jendela login Threads… selesaikan verifikasi bila muncul."
          : "cek sesi…";
        const r = act === "threads-login"
          ? await api("/api/providers/threads/login", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
          : await api("/api/providers/threads/session");
        show(out, r);
        // Refresh the matrix so the tag flips LIVE once the session is live.
        const fresh = await api("/api/providers");
        el("#providers").innerHTML = fresh.body.providers.map(providerRows).join("");
        for (const b of el("#providers").querySelectorAll("button[data-act]")) b.onclick = () => handle(b);
        bindActions(view, (b2) => {
          if (b2.getAttribute("data-act") === "run-check") return;
          handle(b2);
        });
        return;
      }

      let r;
      if (act === "account") r = await api(`/api/providers/${slug}/account`);
      else if (act === "validate")
        r = await api(`/api/providers/${slug}/validate`, {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(composerBody()),
        });
      else
        r = await api(`/api/providers/${slug}/publish`, {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(composerBody()),
        });
      show(out, r);
    }

    bindActions(view, (btn) => {
      // only the provider action buttons; run-check is bound separately below
      if (btn.getAttribute("data-act") === "run-check") return;
      handle(btn);
    });

    view.querySelector('[data-act="run-check"]').onclick = async () => {
      const box = document.createElement("pre");
      box.className = "out";
      box.textContent = "cek koneksi…";
      el("#providers").prepend(box);
      show(box, await api("/api/run-check"));
    };

    const { body } = await api("/api/providers");
    el("#providers").innerHTML = body.providers.map(providerRows).join("");
    for (const b of el("#providers").querySelectorAll("button[data-act]")) b.onclick = () => handle(b);
  },
};
