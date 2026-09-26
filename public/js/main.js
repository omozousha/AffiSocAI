/* main.js — app shell entry point. Route hash → active route module. */
import { startRouter } from "./router.js";
import { logFeed } from "./core.js";

startRouter();

// Sidebar error badge: driven by the shared log feed, so there is exactly one
// open SSE connection for the whole tab.
const badgeEl = document.getElementById("errBadge");
if (badgeEl) {
  let errs = 0;
  logFeed.subscribe((r) => {
    if (r.level !== "error") return;
    errs += 1;
    badgeEl.textContent = errs;
    badgeEl.title = `${errs} error sejak tab dibuka`;
    badgeEl.classList.remove("hidden");
  });
}
