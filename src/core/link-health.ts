/**
 * Link health: probe every short link (HEAD/GET follow) and classify by the
 * FINAL url. Shopee short links redirect 301 -> product page when alive,
 * -> shope.ee/error_page (or an error/404 page) when the campaign died —
 * proven live: valid id3 -> /opaanlp/1337935037/..., garbage -> error_page.
 *
 * Dead links are excluded from scheduler pickLink: posting a dead affiliate
 * link burns the slot AND the commission. `link_dead_streak` counts consecutive
 * dead checks; first death is logged as warn (could be transient), 2+ as error.
 */
import { store as db } from "./store.ts";
import { logActivity } from "./activity-log.ts";

export type HealthResult = { checked: number; alive: number; dead: number };

function classify(finalUrl: string, status: number): "alive" | "dead" {
  if (status >= 400) return "dead";
  const u = finalUrl.toLowerCase();
  if (/error_page|\/error|404|product_unavailable|doesnotexist/.test(u)) return "dead";
  // A live Shopee affiliate link must land on a shopee product/shop path.
  if (/shopee?\.(co\.id|ee|com)(\/.*)?$/.test(u) && !/error/.test(u)) return "alive";
  return "dead";
}

async function probe(url: string): Promise<{ finalUrl: string; status: number }> {
  try {
    const r = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(12_000),
      headers: { "user-agent": "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36" },
    });
    return { finalUrl: r.url || url, status: r.status };
  } catch {
    // network blip = NOT dead (don't punish the link for our own egress);
    // keep the previous health, just refresh the timestamp.
    return { finalUrl: "", status: -1 };
  }
}

export async function checkLinkHealth(): Promise<HealthResult> {
  const links = db.prepare(`SELECT id, short_url, link_dead_streak FROM links WHERE short_url IS NOT NULL AND short_url <> ''`).all() as unknown as { id: number; short_url: string; link_dead_streak: number | null }[];
  let alive = 0, dead = 0;
  for (const l of links) {
    const { finalUrl, status } = await probe(l.short_url);
    const now = new Date().toISOString();
    if (status === -1) {
      db.prepare(`UPDATE links SET link_checked_at = ? WHERE id = ?`).run(now, l.id);
      continue;
    }
    const h = classify(finalUrl, status);
    const streak = h === "dead" ? (l.link_dead_streak ?? 0) + 1 : 0;
    db.prepare(`UPDATE links SET link_health = ?, link_checked_at = ?, link_dead_streak = ? WHERE id = ?`).run(h, now, streak, l.id);
    if (h === "alive") alive++;
    else {
      dead++;
      logActivity({
        level: streak >= 2 ? "error" : "warn",
        source: "system",
        event: "link.health",
        message: `link ${l.id} ${h === "dead" ? "MATI" : "hidup"} (${status}) -> ${finalUrl.slice(0, 90)}`,
        meta: { link_id: l.id, health: h, streak, final: finalUrl.slice(0, 140) },
      });
    }
  }
  return { checked: links.length, alive, dead };
}
