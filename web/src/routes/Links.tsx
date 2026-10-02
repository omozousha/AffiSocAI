import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
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
  const [toast, setToast] = useState("");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("new");
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [preview, setPreview] = useState<PreviewItem[] | null>(null);
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

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 3000);
    return () => clearTimeout(t);
  }, [toast]);

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
      setToast("isi link dulu");
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
      setToast("isi link dulu");
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
        setToast(`${n} link tersimpan`);
        setBlob("");
        setDryOut("");
        load();
      } else {
        setToast(r.body.error || "gagal menyimpan");
      }
    } catch (e) {
      setToast(String(e));
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
        setToast(r.status === 200 ? `terbit: ${r.body.platform} #${r.body.content_id}` : r.body.error || "posting gagal");
      } else if (act === "hapus") {
        const r = await api<{ error?: string }>(`/api/links/${id}`, { method: "DELETE" });
        setToast(r.status === 200 ? `link #${id} dihapus` : r.body.error || "gagal menghapus");
      } else if (act === "enrich") {
        const r = await api<{ error?: string }>(`/api/links/${id}/enrich`, { method: "POST" });
        setToast(r.status === 200 ? `#${id} enriched` : r.body.error || "enrich gagal");
      } else if (act === "recreate") {
        const r = await api<{ error?: string; jobId?: string; status?: string }>(`/api/links/${id}/recreate-image`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        });
        if (r.status === 202 && r.body.jobId) {
          // Flow async — poll until done
          const jobId = r.body.jobId;
          setToast(`🍌 Flow generate dimulai — menunggu hasil…`);
          const poll = async () => {
            for (let i = 0; i < 60; i++) {
              await new Promise(res => setTimeout(res, 5000));
              try {
                const p = await api<{ status: string; result?: { ok?: boolean; live?: boolean; backend?: string; error?: string; served_url?: string } }>(
                  `/api/links/${id}/recreate-image/status?jobId=${jobId}`
                );
                if (p.body.status === "running") {
                  setToast(`🍌 Flow sedang generate… ${((i + 1) * 5)}s`);
                  continue;
                }
                if (p.body.status === "done") {
                  const res = p.body.result;
                  setToast(res?.ok && res?.live
                    ? `✅ Flow berhasil (${res.backend}) — gambar #${id} diperbarui`
                    : res?.ok && !res?.live
                      ? `⚠️ Flow generate tapi gate reject — foto asli dipakai`
                      : `❌ Flow gagal: ${res?.error || "unknown"}`);
                  load();
                  return;
                }
                if (p.body.status === "error") {
                  setToast(`❌ Flow error: ${p.body.result?.error || "unknown"}`);
                  return;
                }
              } catch { /* ignore poll error, retry */ }
            }
            setToast("⏱ Flow timeout — cek lagi nanti");
          };
          poll().finally(() => { setRowBusy(null); load(); });
          return; // skip the finally below — poll handles cleanup
        } else {
          setToast(r.status === 200 ? `gambar #${id} dibuat ulang` : r.body.error || "recreate gagal");
        }
      } else if (act === "bio") {
        const r = await api<{ error?: string }>("/api/bio/publish", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ link_id: id }),
        });
        setToast(r.status >= 200 && r.status < 300 ? `bio #${id} terbit` : r.body.error || "bio gagal");
      }
      load();
    } catch (e) {
      setToast(String(e));
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
    setToast(ok === previewIds.length ? `${ok} produk terbit` : `${ok}/${previewIds.length} terbit`);
    load();
  };

  const bulkDelete = async () => {
    const ids = [...sel];
    if (!ids.length) return;
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
    setToast(ok === ids.length ? `${ok} link dihapus` : `${ok}/${ids.length} dihapus`);
    load();
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Link</h1>
          <p className="text-sm text-zinc-400">Shopee link → auto-fetch produk → append bio sheet</p>
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

      {toast && <p className="text-sm text-emerald-200">{toast}</p>}
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
          {dryOut && <p className="text-xs text-zinc-400">{dryOut}</p>}
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
            rows.map((l) => (
              <div key={l.id} className="flex gap-3 rounded-md border border-zinc-800 p-3">
                <input
                  type="checkbox"
                  checked={sel.has(l.id)}
                  onChange={() => toggle(l.id)}
                  aria-label={`pilih link ${l.id}`}
                  className="mt-1"
                />
                {l.image_url ? (
                  <img src={l.image_url} alt="" loading="lazy" className="h-16 w-16 flex-none rounded object-cover" />
                ) : (
                  <span className="flex h-16 w-16 flex-none items-center justify-center rounded bg-zinc-800 text-xs text-zinc-500">
                    —
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <a
                    href={l.short_url}
                    target="_blank"
                    rel="noopener"
                    className="truncate text-sm font-medium hover:underline"
                  >
                    {l.product || l.kategori || l.short_url}
                  </a>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {l.kategori && <Badge variant="secondary">{l.kategori}</Badge>}
                    {l.image_url?.startsWith("/api/") ? (
                      <Badge variant="outline">lokal</Badge>
                    ) : l.image_url ? (
                      <Badge variant="outline">cdn</Badge>
                    ) : (
                      <Badge variant="destructive">no img</Badge>
                    )}
                    {(l as any).published_count ? (
                      <Badge variant="outline">published{(l as any).published_count > 1 ? ` x${(l as any).published_count}` : ""}</Badge>
                    ) : null}
                  </div>
                  {l.deskripsi && (
                    <p className="mt-1 truncate text-xs text-zinc-400">
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
            ))
          ) : (
            <p className="text-sm text-zinc-500">
              {q ? `tidak ada hasil untuk “${q}”.` : "belum ada link"}
            </p>
          )}
        </CardContent>
      </Card>

      {preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-lg rounded-lg border border-zinc-700 bg-zinc-950 p-5">
            <h3 className="mb-1 text-base font-semibold">Posting {preview.length} produk?</h3>
            <p className="mb-3 text-sm text-zinc-400">Pratinjau sebelum posting ke semua platform.</p>
            <div className="mb-4 flex max-h-[50vh] flex-col gap-2 overflow-y-auto">
              {preview.map((p, i) => (
                <div key={i} className="flex gap-2 rounded-md border border-zinc-800 p-2">
                  {p.image ? (
                    <img src={p.image} alt="" className="h-16 w-16 flex-none rounded object-cover" />
                  ) : (
                    <span className="flex h-16 w-16 flex-none items-center justify-center rounded bg-zinc-800 text-xs text-zinc-500">
                      —
                    </span>
                  )}
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{p.title}</div>
                    {p.desc && <div className="truncate text-xs text-zinc-400">{p.desc.slice(0, 100)}</div>}
                    <div className="text-xs text-zinc-500">{p.meta}</div>
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
