import type { Link } from "../../lib/format";

export type Pool = { total: number; usable: number; cooling: number; dead: number; no_image: number };

/** P2.10 — 4 headline stats; pool card warns when the postable pool is thin. */
export function StatGrid({ links, pool, publishedToday, slotCount, failed7h, published7h }: {
  links: Link[];
  pool?: Pool;
  publishedToday: number;
  slotCount: number;
  failed7h: number;
  published7h: number;
}) {
  const cards = [
    { k: "Link", v: links.length, sub: `${links.filter((l) => l.link_health === "alive").length} hidup` },
    {
      k: "Pool siap posting",
      v: pool?.usable ?? links.length,
      sub: pool ? `${pool.cooling} cooling · ${pool.dead} mati` : "—",
    },
    { k: "Terbit hari ini", v: publishedToday, sub: `${slotCount} slot` },
    { k: "Gagal 7h", v: failed7h, sub: `${published7h} terbit` },
  ];
  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {cards.map((s) => (
          <div key={s.k} className="rounded-lg border border-line bg-panel p-3">
            <div className="text-xs text-muted">{s.k}</div>
            <div className="num mt-1 text-2xl font-bold leading-none">{s.v}</div>
            <div className="mt-1 text-[11px] text-faint">{s.sub}</div>
          </div>
        ))}
      </div>
      {(pool?.usable ?? 99) < 3 && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
          Pool link tinggal {pool?.usable ?? 0} — tambah link Shopee atau bersihkan yang mati sebelum posting macet.
        </p>
      )}
    </>
  );
}
