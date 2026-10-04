import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Spinner } from "../../components/ui/spinner";

export interface LinkRow {
  id: number;
  product?: string;
  short_url?: string;
  kategori?: string;
  deskripsi?: string;
  image_url?: string;
  sheet_id?: string | number | null;
  link_health?: string | null;
  link_checked_at?: string | null;
  published_count?: number;
  published_url?: string | null;
}

/** Baris produk: thumbnail + badge status + aksi row. Pure presentational. */
export function LinkRowView({
  l,
  checked,
  rowBusy,
  onToggle,
  onImg,
  onAction,
}: {
  l: LinkRow;
  checked: boolean;
  rowBusy: string | null;
  onToggle: (id: number) => void;
  onImg: (src: string, title: string) => void;
  onAction: (act: string, id: number) => void;
}) {
  return (
    <div className="md:grid md:grid-cols-[1rem_5rem_minmax(0,1fr)_auto] md:items-start md:gap-3 flex gap-3 rounded-md border border-line p-3">
      <input
        type="checkbox"
        checked={checked}
        onChange={() => onToggle(l.id)}
        aria-label={`pilih link ${l.id}`}
        className="mt-1"
      />
      <button
        type="button"
        onClick={() => onImg(l.image_url || "", l.product || l.kategori || l.short_url || `#${l.id}`)}
        className="group relative h-20 w-20 flex-none overflow-hidden rounded md:h-16 md:w-16"
        title={`${l.product || l.kategori || l.short_url} — tap untuk preview`}
      >
        {l.image_url ? (
          <img src={l.image_url} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <span className="flex h-full w-full items-center justify-center bg-elev text-xs text-muted">—</span>
        )}
        <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/50 to-transparent px-1.5 pb-1 pt-5 text-[10px] font-medium leading-tight line-clamp-2 text-white">
          {l.product || l.kategori || l.short_url}
        </span>
      </button>
      <div className="min-w-0 flex-1">
        <div className="mt-1 flex flex-wrap gap-1">
          {l.kategori && <Badge variant="secondary">{l.kategori}</Badge>}
          {l.link_health === "dead" && <Badge variant="destructive">link mati</Badge>}
          {l.link_health === "alive" && <Badge variant="outline" className="text-accent border-accent/40">link hidup</Badge>}
          {l.image_url?.startsWith("/api/") ? (
            <Badge variant="outline">lokal</Badge>
          ) : l.image_url ? (
            <Badge variant="outline">cdn</Badge>
          ) : (
            <Badge variant="destructive">no img</Badge>
          )}
          {l.published_count ? (
            l.published_url ? (
              <a href={l.published_url} target="_blank" rel="noopener" className="inline-flex items-center gap-1 rounded border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-[11px] text-accent hover:border-accent/70">
                ✓ posted{l.published_count > 1 ? ` x${l.published_count}` : ""} ↗
              </a>
            ) : (
              <Badge variant="outline" className="border-amber-700/60 text-amber-300">✓ posted{l.published_count > 1 ? ` x${l.published_count}` : ""} (permalink menyusul)</Badge>
            )
          ) : null}
        </div>
        {l.deskripsi && (
          <p className="mt-1 truncate text-xs text-muted">
            {l.deskripsi.slice(0, 140)}
          </p>
        )}
        <div className="mt-2 flex flex-wrap gap-1">
          <Button size="sm" disabled={rowBusy === `${l.id}-posting`} onClick={() => onAction("posting", l.id)}>
            {rowBusy === `${l.id}-posting` ? <Spinner label="Posting…" /> : "Posting"}
          </Button>
          <Button size="sm" variant="secondary" disabled={rowBusy === `${l.id}-recreate`} onClick={() => onAction("recreate", l.id)}>
            {rowBusy === `${l.id}-recreate` ? <Spinner label="Recreate…" /> : "Recreate"}
          </Button>
          <Button size="sm" variant="ghost" disabled={rowBusy === `${l.id}-bio`} onClick={() => onAction("bio", l.id)}>
            {rowBusy === `${l.id}-bio` ? <Spinner label="Bio…" /> : "Bio"}
          </Button>
          <Button size="sm" variant="ghost" disabled={rowBusy === `${l.id}-enrich`} onClick={() => onAction("enrich", l.id)}>
            {rowBusy === `${l.id}-enrich` ? <Spinner label="Enrich…" /> : "Enrich"}
          </Button>
          <Button size="sm" variant="destructive" disabled={rowBusy === `${l.id}-hapus`} onClick={() => onAction("hapus", l.id)}>
            {rowBusy === `${l.id}-hapus` ? <Spinner label="Hapus…" /> : "Hapus"}
          </Button>
        </div>
      </div>
    </div>
  );
}
