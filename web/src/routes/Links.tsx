import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { useToast } from "../components/ui/toast";
import { confirmDlg } from "../components/ui/confirm";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Input, Select, Textarea } from "../components/ui/input";
import { Skeleton } from "../components/ui/skeleton";
import { Spinner } from "../components/ui/spinner";
import { api } from "../lib/utils";

interface LinkRow {
  id: number;
  product?: string;
  short_url?: string;
  kategori?: string;
  deskripsi?: string;
  image_url?: string;
  sheet_id?: string | number | null;
  link_health?: string | null;
  link_checked_at?: string | null;
}

interface PreviewItem {
  image: string;
  title: string;
  desc: string;
  meta: string;
}

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
  // Form tambah
  const [blob, setBlob] = useState("");
  const [kategori, setKategori] = useState("");
  const [formBusy, setFormBusy] = useState(false);
  const [dryOut, setDryOut] = useState("");
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

  const parseBlob = () =>
    blob.split(/[\n,;\s]+/).map((s) => s.trim()).filter(Boolean);

  const doDry = async () => {
    const items = parseBlob();
    if (!items.length) {
      toast("isi link dulu");
      return;
    }
    setFormBusy(true);
    try {
      const r = await api<{ results?: { status: string }[]; dryRun?: boolean }>("/api/links", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ links: items, ...(kategori ? { kategori } : {}), dryRun: true }),
      });
      const res = r.body.results || [];
      const ok = res.filter((x) => x.status !== "rejected").length;
      setDryOut(`${ok}/${res.length} siap (dry-run, belum disimpan)`);
    } catch (e) {
      setDryOut(`gagal: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setFormBusy(false);
    }
  };

  const doSave = async () => {
    const items = parseBlob();
    if (!items.length) {
      toast("isi link dulu");
      return;
    }
    setFormBusy(true);
    try {
      const r = await api<{ results?: { status: string }[]; error?: string }>("/api/links", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ links: items, ...(kategori ? { kategori } : {}) }),
      });
      if (r.status >= 200 && r.status < 300) {
        const n = r.body.results?.filter((x) => x.status !== "rejected").length ?? items.length;
        toast(`${n} link tersimpan`);
        setBlob("");
        setDryOut("");
        load();
      } else {
        toast(r.body.error || "gagal menyimpan");
      }
    } catch (e) {
      toast(String(e));
    } finally {
      setFormBusy(false);
    }
  };

  const rowAction = async (act: string, id: number) => {
    const key = `${id}-${act}`;
    setRowBusy(key);
    try {
      if (act === "posting") {
        const r = await api<{ error?: string; platform?: string; content_id?: number }>(
          `/api/links/${id}/post`,
          { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
        );
        toast(r.status === 200 ? `terbit: ${r.body.platform} #${r.body.content_id}` : r.body.error || "posting gagal");
      } else if (act === "hapus") {
        const okc = await confirmDlg({ title: `Hapus link #${id}?`, body: "Konten terkait ikut terhapus. Tidak bisa dibatalkan.", danger: true, okLabel: "Hapus" });
        if (!okc) return;
        const r = await api<{ error?: string }>(`/api/links/${id}`, { method: "DELETE" });
        toast(r.status === 200 ? `link #${id} dihapus` : r.body.error || "gagal menghapus");
      } else if (act === "enrich") {
        const r = await api<{ error?: string }>(`/api/links/${id}/enrich`, { method: "POST" });
        toast(r.status === 200 ? `#${id} enriched` : r.body.error || "enrich gagal");
      } else if (act === "recreate") {
        const r = await api<{ error?: string; jobId?: string; status?: string }>(`/api/links/${id}/recreate-image`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        });
        if (r.status === 202 && r.body.jobId) {
          // Flow async — poll until done
          const jobId = r.body.jobId;
          toast(`🍌 Flow generate dimulai — menunggu hasil…`);
          const poll = async () => {
            for (let i = 0; i < 60; i++) {
              await new Promise(res => setTimeout(res, 5000));
              try {
                const p = await api<{ status: string; result?: { ok?: boolean; live?: boolean; backend?: string; error?: string; served_url?: string } }>(
                  `/api/links/${id}/recreate-image/status?jobId=${jobId}`
                );
                if (p.body.status === "running") {
                  toast(`🍌 Flow sedang generate… ${((i + 1) * 5)}s`);
                  continue;
                }
                if (p.body.status === "done") {
                  const res = p.body.result;
                  toast(res?.ok && res?.live
                    ? `✅ Flow berhasil (${res.backend}) — gambar #${id} diperbarui`
                    : res?.ok && !res?.live
                      ? `⚠️ Flow generate tapi gate reject — foto asli dipakai`
                      : `❌ Flow gagal: ${res?.error || "unknown"}`);
                  load();
                  return;
                }
                if (p.body.status === "error") {
                  toast(`❌ Flow error: ${p.body.result?.error || "unknown"}`);
                  return;
                }
              } catch { /* ignore poll error, retry */ }
            }
            toast("⏱ Flow timeout — cek lagi nanti");
          };
          poll().finally(() => { setRowBusy(null); load(); });
          return; // skip the finally below — poll handles cleanup
        } else {
          toast(r.status === 200 ? `gambar #${id} dibuat ulang` : r.body.error || "recreate gagal");
        }
      } else if (act === "bio") {
        const r = await api<{ error?: string }>("/api/bio/publish", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ link_id: id }),
        });
        toast(r.status >= 200 && r.status < 300 ? `bio #${id} terbit` : r.body.error || "bio gagal");
      }
      load();
    } catch (e) {
      toast(String(e));
    } finally {
      setRowBusy(null);
    }
  };

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
    toast(ok === previewIds.length ? `${ok} produk terbit` : `${ok}/${previewIds.length} terbit`);
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
    toast(ok === ids.length ? `${ok} link dihapus` : `${ok}/${ids.length} dihapus`);
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

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Tambah link</CardTitle>
            <CardDescription>Link Shopee → cek data produk + gambar → simpan.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <Textarea
            value={blob}
            onChange={(e) => setBlob(e.target.value)}
            placeholder="https://s.shopee.co.id/xxxxxxx"
          />
          <div className="flex gap-2">
            <Input
              value={kategori}
              onChange={(e) => setKategori(e.target.value)}
              placeholder="Kategori (opsional)"
            />
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" disabled={formBusy} onClick={doDry}>
              {formBusy ? <Spinner label="Cek…" /> : "Cek data (dry-run)"}
            </Button>
            <Button size="sm" disabled={formBusy} onClick={doSave}>
              {formBusy ? <Spinner label="Simpan…" /> : "Simpan & append ke sheet"}
            </Button>
          </div>
          {dryOut && <p className="text-xs text-muted">{dryOut}</p>}
        </CardContent>
      </Card>

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
              <div key={l.id} className="md:grid md:grid-cols-[1rem_5rem_minmax(0,1fr)_auto] md:items-start md:gap-3 flex gap-3 rounded-md border border-line p-3">
                <input
                  type="checkbox"
                  checked={sel.has(l.id)}
                  onChange={() => toggle(l.id)}
                  aria-label={`pilih link ${l.id}`}
                  className="mt-1"
                />
                <button
                  type="button"
                  onClick={() => setImgPreview({ src: l.image_url || "", title: l.product || l.kategori || l.short_url || `#${l.id}` })}
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
                    {(l as any).published_count ? (
                      (l as any).published_url ? (
                        <a href={(l as any).published_url} target="_blank" rel="noopener" className="inline-flex items-center gap-1 rounded border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-[11px] text-accent hover:border-accent/70">
                          ✓ posted{(l as any).published_count > 1 ? ` x${(l as any).published_count}` : ""} ↗
                        </a>
                      ) : (
                        <Badge variant="outline" className="border-amber-700/60 text-amber-300">✓ posted{(l as any).published_count > 1 ? ` x${(l as any).published_count}` : ""} (permalink menyusul)</Badge>
                      )
                    ) : null}
                  </div>
                  {l.deskripsi && (
                    <p className="mt-1 truncate text-xs text-muted">
                      {l.deskripsi.slice(0, 140)}
                    </p>
                  )}
                  <div className="mt-2 flex flex-wrap gap-1">
                    <Button size="sm" disabled={rowBusy === `${l.id}-posting`} onClick={() => rowAction("posting", l.id)}>
                      {rowBusy === `${l.id}-posting` ? <Spinner label="Posting…" /> : "Posting"}
                    </Button>
                    <Button size="sm" variant="secondary" disabled={rowBusy === `${l.id}-recreate`} onClick={() => rowAction("recreate", l.id)}>
                      {rowBusy === `${l.id}-recreate` ? <Spinner label="Recreate…" /> : "Recreate"}
                    </Button>
                    <Button size="sm" variant="ghost" disabled={rowBusy === `${l.id}-bio`} onClick={() => rowAction("bio", l.id)}>
                      {rowBusy === `${l.id}-bio` ? <Spinner label="Bio…" /> : "Bio"}
                    </Button>
                    <Button size="sm" variant="ghost" disabled={rowBusy === `${l.id}-enrich`} onClick={() => rowAction("enrich", l.id)}>
                      {rowBusy === `${l.id}-enrich` ? <Spinner label="Enrich…" /> : "Enrich"}
                    </Button>
                    <Button size="sm" variant="destructive" disabled={rowBusy === `${l.id}-hapus`} onClick={() => rowAction("hapus", l.id)}>
                      {rowBusy === `${l.id}-hapus` ? <Spinner label="Hapus…" /> : "Hapus"}
                    </Button>
                  </div>
                </div>
              </div>
            ))}
            {rows.length > cap && (
              <Button size="sm" variant="ghost" className="w-full" onClick={() => setCap((c) => c + 50)}>
                Muat lebih banyak (sisa {rows.length - cap})
              </Button>
            )}
            </>
          ) : (
            <p className="text-sm text-muted">
              {q ? `tidak ada hasil untuk “${q}”.` : "belum ada link"}
            </p>
          )}
        </CardContent>
      </Card>

      {imgPreview && (
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-black/85 p-4"
          onClick={() => setImgPreview(null)}
          role="dialog"
          aria-label="Preview gambar"
        >
          {imgPreview.src ? (
            <img
              src={imgPreview.src}
              alt={imgPreview.title}
              className="max-h-[75vh] max-w-full rounded-lg object-contain"
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <div className="flex h-40 w-40 items-center justify-center rounded-lg bg-elev text-muted">
              tidak ada gambar
            </div>
          )}
          <div className="w-full max-w-lg text-center text-sm text-fg/90" onClick={(e) => e.stopPropagation()}>
            {imgPreview.title}
          </div>
          <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
            <Button size="sm" variant="secondary" onClick={() => setImgPreview(null)}>
              Tutup
            </Button>
          </div>
        </div>
      )}

      {preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-lg rounded-lg border border-line bg-transparent p-5">
            <h3 className="mb-1 text-base font-semibold">Posting {preview.length} produk?</h3>
            <p className="mb-3 text-sm text-muted">Pratinjau sebelum posting ke semua platform.</p>
            <div className="mb-4 flex max-h-[50vh] flex-col gap-2 overflow-y-auto">
              {preview.map((p, i) => (
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
              <Button variant="ghost" onClick={() => setPreview(null)}>
                Batal
              </Button>
              <Button disabled={bulkBusy} onClick={confirmBulkPost}>
                {bulkBusy ? <Spinner label="Posting…" /> : "Posting semua"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
