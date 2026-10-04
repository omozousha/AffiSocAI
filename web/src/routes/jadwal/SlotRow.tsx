import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Spinner } from "../../components/ui/spinner";
import { PLAT_LABEL, STATUS_LABEL, STATUS_VARIANT, wibHm, type BadgeVariant, type Slot } from "../../lib/format";

function platBadge(n: string) {
  const known = n === "instagram" || n === "facebook" || n === "threads";
  return (
    <Badge key={n} variant={known ? "default" : "outline"}>
      {PLAT_LABEL[n] || n}
    </Badge>
  );
}

const platList = (s: Slot) =>
  String(s.platform || "").split(",").map((x) => x.trim()).filter(Boolean).map(platBadge);

/** Baris slot jadwal. `interactive` = hari ini (aksi + lock + next-border); selainnya read-only. */
export function SlotRow({
  s,
  isNext = false,
  busyId = null,
  onRun,
  compact = false,
}: {
  s: Slot;
  isNext?: boolean;
  busyId?: number | null;
  onRun?: (id: number) => void;
  compact?: boolean;
}) {
  const locked = !compact && s.status === "published";
  return (
    <div
      className={`md:grid md:grid-cols-[3.5rem_minmax(0,1fr)_auto] md:items-center md:gap-3 flex items-center gap-3 rounded-md border p-3 ${
        isNext ? "border-accent" : "border-line"
      }`}
    >
      <div className="w-14 flex-none text-lg font-bold">
        {wibHm(s.scheduled_for)}
        <span className="block text-[10px] font-normal text-muted">WIB</span>
      </div>
      <div className="min-w-0 flex-1">
        <div
          className="truncate text-sm font-medium"
          title={compact ? `Slot ${s.slot_index + 1}` : `Slot ${s.slot_index + 1} · ${s.link_id != null ? "link " + s.link_id : "link otomatis"}`}
        >
          {compact ? `Slot ${s.slot_index + 1}` : `Slot ${s.slot_index + 1} · ${s.link_id != null ? `link ${s.link_id}` : "link otomatis"}`}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1">
          <Badge variant={(STATUS_VARIANT[s.status] ?? "outline") as BadgeVariant}>
            {STATUS_LABEL[s.status] ?? s.status}
          </Badge>
          {platList(s)}
        </div>
        {!compact && (s as { post_id?: string | number }).post_id && (
          <div className="mt-1 text-xs text-muted">
            post {String((s as { post_id?: string }).post_id).slice(0, 24)}
          </div>
        )}
        {!compact && (s as { error?: string }).error && (
          <div className="mt-1 text-xs text-red-400">
            {(s as { error?: string }).error?.slice(0, 200)}
          </div>
        )}
      </div>
      {!compact && (
        <div className="md:justify-self-end">
          {locked ? (
            <span title="sudah terbit, terkunci">🔒</span>
          ) : (
            <Button
              size="sm"
              variant={s.status === "failed" ? "secondary" : "default"}
              disabled={busyId === s.id}
              onClick={() => onRun?.(s.id)}
            >
              {busyId === s.id ? <Spinner label={s.status === "failed" ? "Coba…" : "Jalan…"} /> : s.status === "failed" ? "Coba lagi" : "Jalankan"}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
