import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "../components/ui/button";
import { useToast } from "../components/ui/toast";
import { confirmDlg } from "../components/ui/confirm";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Input, Select } from "../components/ui/input";
import { Skeleton } from "../components/ui/skeleton";
import { Empty } from "../components/ui/empty";
import { api } from "../lib/utils";
import { LinkAddForm } from "./links/LinkAddForm";
import { LinkRowView, type LinkRow } from "./links/LinkRowView";
import { makeLinkActions } from "./links/useLinkActions";
import { BulkPreviewModal, ImgLightbox, type PreviewItem } from "./links/Previews";

export default function Links({ go }: { go: (r: string) => void }) {
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const { toast } = useToast();
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("new");
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [cap, setCap] = useState(50);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [preview, setPreview] = useState<PreviewItem[] | null>(null);
  const [imgPreview, setImgPreview] = useState<{ src: string; title: string } | null>(null);
  const [previewIds, setPreviewIds] = useState<number[]>([]);
  // Per-row action spinner: id-act (mis. "12-recreate").
  const [rowBusy, setRowBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api<{ links?: LinkRow[] }>("/api/links");
      setLinks(r.body.links ?? []);
      setErr("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const rows = useMemo(() => {
    const needle = q.toLowerCase().trim();
    let out = needle
      ? links.filter((l) =>
          `${l.product || ""} ${l.kategori || ""} ${l.short_url || ""}`.toLowerCase().includes(needle),
        )
      : [...links];
    if (sort === "old") out.sort((a, b) => a.id - b.id);
    else if (sort === "az")
      out.sort((a, b) => String(a.product || "").localeCompare(String(b.product || "")));
    else out.sort((a, b) => b.id - a.id);
    return out;
  }, [links, q, sort]);

  const toggle = (id: number) => {
    setSel((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const rowAction = useMemo(
    () => makeLinkActions({ toast, confirm: confirmDlg, setRowBusy, load }),
    [toast, load],
  );

  const openBulkPreview = () => {
    const ids = [...sel];
    if (!ids.length) return;
    const byId = new Map(links.map((l) => [l.id, l]));
    setPreviewIds(ids);
    setPreview(
      ids.map((id) => {
        const l = byId.get(id);
        return {
          image: l?.image_url || "",
          title: l ? l.product || l.short_url || `#${id}` : `#${id}`,
          desc: l?.deskripsi || "",
          meta: `link #${id} → semua platform`,
        };
      }),
    );
  };

  const confirmBulkPost = async () => {
    setBulkBusy(true);
    let ok = 0;
    for (const id of previewIds) {
      try {
        const r = await api(`/api/links/${id}/post`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        });
        if (r.status === 200) ok++;
      } catch {
        /* lanjut */
      }
    }
    setPreview(null);
    setSel(new Set());
    setBulkBusy(false);
    toast(ok === previewIds.length ? `${ok} produk terbit` : `${ok}/${previewIds.length} terbit`, ok === previewIds.length ? "ok" : "err");
    load();
  };

  const bulkDelete = async () => {
    const ids = [...sel];
    if (!ids.length) return;
    const okc = await confirmDlg({ title: `Hapus ${ids.length} link?`, body: "Semua konten terkait ikut terhapus permanen.", danger: true, okLabel: "Hapus semua" });
    if (!okc) return;
    setBulkBusy(true);
    let ok = 0;
    for (const id of ids) {
      try {
        const r = await api(`/api/links/${id}`, { method: "DELETE" });
        if (r.status === 200) ok++;
      } catch {
        /* lanjut */
      }
    }
    setSel(new Set());
    setBulkBusy(false);
    toast(ok === ids.length ? `${ok} link dihapus` : `${ok}/${ids.length} dihapus`, ok === ids.length ? "ok" : "err");
    load();
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Link</h1>
          <p className="text-sm text-muted">Shopee link → auto-fetch produk → append bio sheet</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" disabled={!sel.size || bulkBusy} onClick={openBulkPreview}>
            Posting terpilih{sel.size ? ` (${sel.size})` : ""}
          </Button>
          <Button size="sm" variant="destructive" disabled={!sel.size || bulkBusy} onClick={bulkDelete}>
            Hapus terpilih{sel.size ? ` (${sel.size})` : ""}
          </Button>
          <Button size="sm" variant="ghost" onClick={load}>
            Refresh
          </Button>
        </div>
      </div>

      {err && <p className="text-sm text-red-400">gagal: {err}</p>}

      <LinkAddForm onSaved={load} />

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Produk tersimpan</CardTitle>
            <CardDescription>{links.length} produk tersimpan</CardDescription>
          </div>
          <Button size="sm" variant="ghost" onClick={() => go("konten")}>
            Buka Konten AI
          </Button>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <div className="flex gap-2">
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Cari produk / kategori…"
              className="flex-1"
            />
            <Select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="urutan">
              <option value="new">Terbaru</option>
              <option value="old">Terlama</option>
              <option value="az">A–Z</option>
            </Select>
          </div>
          {loading ? (
            <>
              <Skeleton className="h-20" />
              <Skeleton className="h-20" />
              <Skeleton className="h-20" />
            </>
          ) : rows.length ? (
            <>
              <div className="md:grid hidden md:grid-cols-[1rem_5rem_minmax(0,1fr)_auto] md:gap-3 px-3 pb-1 text-[11px] text-muted sticky top-0 z-20 bg-panel/95 backdrop-blur" aria-hidden>
                <span>pilih</span><span>foto</span><span>produk / status</span><span className="md:justify-self-end">aksi</span>
              </div>
              {rows.slice(0, cap).map((l) => (
                <LinkRowView
                  key={l.id}
                  l={l}
                  checked={sel.has(l.id)}
                  rowBusy={rowBusy}
                  onToggle={toggle}
                  onImg={(src, title) => setImgPreview({ src, title })}
                  onAction={rowAction}
                />
              ))}
              {rows.length > cap && (
                <Button size="sm" variant="ghost" className="w-full" onClick={() => setCap((c) => c + 50)}>
                  Muat lebih banyak (sisa {rows.length - cap})
                </Button>
              )}
            </>
          ) : q ? (
            <p className="text-sm text-muted">tidak ada hasil untuk “{q}”.</p>
          ) : (
            <Empty
              title="Belum ada link"
              desc="Tempel link Shopee di form Tambah link di atas — produk, gambar, dan bio terisi otomatis."
              action={
                <Button size="sm" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
                  Tambah link pertama
                </Button>
              }
            />
          )}
        </CardContent>
      </Card>

      {imgPreview && (
        <ImgLightbox
          src={imgPreview.src}
          title={imgPreview.title}
          onClose={() => setImgPreview(null)}
        />
      )}

      {preview && (
        <BulkPreviewModal
          items={preview}
          busy={bulkBusy}
          onCancel={() => setPreview(null)}
          onConfirm={confirmBulkPost}
        />
      )}
    </div>
  );
}
