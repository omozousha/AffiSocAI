import { useEffect } from "react";
import { Button } from "../../components/ui/button";
import { Spinner } from "../../components/ui/spinner";

export interface PreviewItem {
  image: string;
  title: string;
  desc: string;
  meta: string;
}

/** Lightbox gambar — Escape/tap latar menutup. */
export function ImgLightbox({
  src,
  title,
  onClose,
}: {
  src: string;
  title: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-black/85 p-4"
      onClick={onClose}
      role="dialog"
      aria-label="Preview gambar"
    >
      {src ? (
        <img
          src={src}
          alt={title}
          className="max-h-[75vh] max-w-full rounded-lg object-contain"
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <div className="flex h-40 w-40 items-center justify-center rounded-lg bg-elev text-muted">
          tidak ada gambar
        </div>
      )}
      <div className="w-full max-w-lg text-center text-sm text-fg/90" onClick={(e) => e.stopPropagation()}>
        {title}
      </div>
      <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
        <Button size="sm" variant="secondary" onClick={onClose}>
          Tutup
        </Button>
      </div>
    </div>
  );
}

/** Modal pratinjau bulk-post: daftar produk + konfirmasi berurutan. */
export function BulkPreviewModal({
  items,
  busy,
  onCancel,
  onConfirm,
}: {
  items: PreviewItem[];
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onCancel} role="dialog" aria-label="Pratinjau posting">
      <div
        className="w-full max-w-lg rounded-lg border border-line bg-panel p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-1 text-base font-semibold">Posting {items.length} produk?</h3>
        <p className="mb-3 text-sm text-muted">Pratinjau sebelum posting ke semua platform.</p>
        <div className="mb-4 flex max-h-[50vh] flex-col gap-2 overflow-y-auto">
          {items.map((p, i) => (
            <div key={i} className="flex gap-2 rounded-md border border-line p-2">
              {p.image ? (
                <img src={p.image} alt="" className="h-16 w-16 flex-none rounded object-cover" />
              ) : (
                <span className="flex h-16 w-16 flex-none items-center justify-center rounded bg-elev text-xs text-muted">
                  —
                </span>
              )}
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{p.title}</div>
                {p.desc && <div className="truncate text-xs text-muted">{p.desc.slice(0, 100)}</div>}
                <div className="text-xs text-muted">{p.meta}</div>
              </div>
            </div>
          ))}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>
            Batal
          </Button>
          <Button disabled={busy} onClick={onConfirm}>
            {busy ? <Spinner label="Posting…" /> : "Posting semua"}
          </Button>
        </div>
      </div>
    </div>
  );
}
