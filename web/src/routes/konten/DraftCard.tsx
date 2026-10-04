import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Spinner } from "../../components/ui/spinner";
import { Textarea } from "../../components/ui/input";

export interface Draft {
  platform: string;
  kind: string;
  body: string;
  media_url?: string;
  needsMedia?: boolean;
}

const LIMITS: Record<string, number> = { instagram: 2200, facebook: 60000, threads: 500 };

/** Kartu satu draft: edit caption + counter limit platform + simpan/posting. */
export function DraftCard({
  d,
  body,
  onBody,
  saveBusy,
  onSave,
  onPost,
}: {
  d: Draft;
  body: string;
  onBody: (v: string) => void;
  saveBusy: boolean;
  onSave: () => void;
  onPost: () => void;
}) {
  const limit = LIMITS[d.platform] ?? 99999;
  return (
    <div className="flex gap-2 rounded-md border border-line p-2">
      {d.media_url ? (
        <img src={d.media_url} alt="" className="h-16 w-16 flex-none rounded object-cover" />
      ) : (
        <span className="h-16 w-16 flex-none rounded bg-elev" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1 text-sm font-medium">
          {d.platform}
          <Badge variant="outline">{d.kind}</Badge>
        </div>
        <Textarea value={body} onChange={(e) => onBody(e.target.value)} className="mt-1" />
        <p className={`text-xs ${body.length > limit ? "text-red-400" : "text-muted"}`}>
          {body.length}/{limit} karakter{d.needsMedia ? " · butuh gambar" : " · link di bio"}
        </p>
        <div className="mt-1 flex gap-1">
          <Button size="sm" variant="secondary" disabled={saveBusy} onClick={onSave}>
            {saveBusy ? <Spinner label="Simpan…" /> : "Simpan draft ini"}
          </Button>
          <Button size="sm" onClick={onPost}>
            Posting
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Konfirmasi posting manual satu platform — tampilkan caption penuh sebelum publish. */
export function PostConfirmModal({
  platform,
  body,
  busy,
  onCancel,
  onConfirm,
}: {
  platform: string;
  body: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onCancel} role="dialog" aria-label="Konfirmasi posting">
      <div className="w-full max-w-md rounded-lg border border-line bg-panel p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-1 text-base font-semibold">Posting ke {platform}?</h3>
        <p className="mb-3 whitespace-pre-wrap text-sm text-muted">{body.slice(0, 400)}</p>
        <p className="mb-3 text-xs text-muted">{body.length} karakter</p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" disabled={busy} onClick={onCancel}>
            Batal
          </Button>
          <Button disabled={busy} onClick={onConfirm}>
            {busy ? <Spinner label="Posting…" /> : "Posting"}
          </Button>
        </div>
      </div>
    </div>
  );
}
