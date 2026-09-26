/* Router + route module registration.
 * Hash-based (#/links, #/konten, #/sosmed, #/logs) so it survives the CDN
 * without any server-side rewrite rules. */

import { linksRoute } from "./routes/links.js";
import { kontenRoute } from "./routes/konten.js";
import { sosmedRoute } from "./routes/sosmed.js";
import { logsRoute } from "./routes/logs.js";

export const routes = {
  links: linksRoute,
  konten: kontenRoute,
  sosmed: sosmedRoute,
  logs: logsRoute,
};

function currentKey() {
  const raw = (location.hash || "").replace(/^#\/?/, "").split("?")[0];
  return routes[raw] ? raw : "links";
}

export function startRouter() {
  const view = document.getElementById("view");
  let current = null;

  async function render() {
    const key = currentKey();
    if (key === current) return;

    // Leaving a route must release its resources: the Logs route holds an open
    // SSE connection, and leaving it open leaks one per navigation.
    const cleanup = view.cleanup;
    if (typeof cleanup === "function") { try { cleanup(); } catch { /* ignore */ } }
    current = key;

    for (const a of document.querySelectorAll(".nav-link"))
      a.classList.toggle("active", a.getAttribute("href") === `#/${key}`);

    const route = routes[key];
    view.innerHTML = route.html();
    if (route.mount) await route.mount(view);
  }

  window.addEventListener("hashchange", render);
  render();
}
