import { useCallback, useEffect, useState } from "react";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Input, Select, Textarea } from "../components/ui/input";
import { Spinner } from "../components/ui/spinner";
import { api } from "../lib/utils";

const POST_PLATS = ["instagram", "facebook", "threads"];

interface Draft {
  platform: string;
  kind: string;
  body: string;
  media_url?: string;
  needsMedia?: boolean;
}

interface ContentRow {
  id: number;
  link_id: number;
  platform: string;
  status: string;
  body: string;
}

interface LinkOpt {
  id: number;
  product?: string;
  short_url?: string;
}

const LIMITS: Record<string, number> = { instagram: 2200, facebook: 60000, threads: 500 };

export default function Konten() {
  const [linkOpts, setLinkOpts] = useState<LinkOpt[]>([]);
  const [linkId, setLinkId] = useState("");
  const [plats, setPlats] = useState<string[]>([...POST_PLATS]);
  const [mode, setMode] = useState("mystery");
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [bodies, setBodies] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [saveBusy, setSaveBusy] = useState<number | null>(null);
  const [postBusy, setPostBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [rows, setRows] = useState<ContentRow[]>([]);
  const [fp, setFp] = useState("");
  const [fs, setFs] = useState("");
  const [confirmPost, setConfirmPost] = useState<{ i: number; platform: string; body: string } | null>(null);

  const loadRows = useCallback(async () => {
    try {
      const r = await api<{ content?: ContentRow[] }>("/api/content");
      setRows(r.body.content || []);
    } catch {
      /* panel tampil kosong */
    }
  }, []);

  useEffect(() => {
    api<{ links?: LinkOpt[] }>("/api/links")
      .then((r) => setLinkOpts(r.body.links || []))
      .catch(() => {});
    loadRows();
  }, [loadRows]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const togglePlat = (p: string) => {
    setPlats((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
  };

  const doGen = async () => {
    const id = Number(linkId);
    if (!id) {
      setToast("isikan Link ID dulu");
      return;
    }
    setBusy(true);
    try {
      const r = await api<{ drafts?: Draft[]; error?: string }>(
        mode === "mystery" ? "/api/content/mystery" : "/api/content/generate",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ link_id: id, platforms: plats }),
        },
      );
      if (r.status !== 200) {
        setToast(r.body.error || "generate gagal");
        return;
      }
      setDrafts(r.body.drafts || []);
      setBodies({});
      setToast(`${(r.body.drafts || []).length} draft dibuat`);
    } catch (e) {
      setToast(String(e));
    } finally {
      setBusy(false);
    }
  };

  const submitDraft = async (i: number) => {
    const d = drafts[i];
    if (!d) return;
    const body = bodies[i] ?? d.body;
    const r = await api("/api/content", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        link_id: Number(linkId),
        platform: d.platform,
        kind: body === d.body ? d.kind : "text",
        body,
        media_url: d.media_url,
      }),
    });
    return r;
  };

  const saveOne = async (i: number) => {
    setSaveBusy(i);
    try {
      const r = await submitDraft(i);
      if (!r) return;
      setToast(r.status === 200 || r.status === 201 ? "draft disimpan" : "simpan gagal");
      loadRows();
    } finally {
      setSaveBusy(null);
    }
  };

  const saveAll = async () => {
    if (!drafts.length) {
      setToast("belum ada draft");
      return;
    }
    setBusy(true);
    try {
      for (let i = 0; i < drafts.length; i++) await submitDraft(i);
      setToast(`${drafts.length} draft disimpan`);
    } finally {
      setBusy(false);
      loadRows();
    }
  };

  const doPost = async () => {
    if (!confirmPost) return;
    const id = Number(linkId);
    setPostBusy(true);
    try {
      const r = await api<{ error?: string; platform?: string; post_id?: string; content_id?: number }>(
        `/api/links/${id}/post`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ platform: confirmPost.platform }),
        },
      );
      setToast(r.status === 200 ? `terbit: ${r.body.platform || confirmPost.platform}` : r.body.error || "posting gagal");
    } catch (e) {
      setToast(String(e));
    } finally {
      setPostBusy(false);
      setConfirmPost(null);
      loadRows();
    }
  };

  const filtered = rows.filter((c) => (!fp || c.platform === fp) && (!fs || c.status === fs));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Konten AI</h1>
          <p className="text-sm text-zinc-400">Generate caption per platform → simpan draft (link tetap di bio)</p>
        </div>
        <Button size="sm" variant="ghost" onClick={loadRows}>
          Refresh
        </Button>
      </div>

      {toast && <p className="text-sm text-emerald-200">{toast}</p>}

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Generate</CardTitle>
            <CardDescription>Mystery: nama produk disembunyikan. Direct: nama disebut.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <Input
              value={linkId}
              onChange={(e) => setLinkId(e.target.value)}
              placeholder="Link ID (mis. 15)"
              inputMode="numeric"
              className="w-36"
            />
            <Select
              value={linkOpts.some((l) => String(l.id) === linkId) ? linkId : ""}
              onChange={(e) => setLinkId(e.target.value)}
              aria-label="pilih link"
            >
              <option value="">— pilih link —</option>
              {linkOpts.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.id} — {l.product || l.short_url}
                </option>
              ))}
            </Select>
            <Select value={mode} onChange={(e) => setMode(e.target.value)} aria-label="mode caption">
              <option value="mystery">Mystery</option>
              <option value="direct">Direct</option>
            </Select>
          </div>
          <div className="flex flex-wrap gap-2">
            {POST_PLATS.map((p) => (
              <label key={p} className="flex items-center gap-1 text-sm">
                <input type="checkbox" checked={plats.includes(p)} onChange={() => togglePlat(p)} />
                {p}
              </label>
            ))}
          </div>
          <div className="flex gap-2">
            <Button size="sm" disabled={busy} onClick={doGen}>
              {busy ? <Spinner label="Generate…" /> : "Generate caption"}
            </Button>
            <Button size="sm" variant="secondary" disabled={busy || !drafts.length} onClick={saveAll}>
              {busy ? <Spinner label="Simpan…" /> : "Simpan semua draft"}
            </Button>
          </div>
          {drafts.map((d, i) => {
            const body = bodies[i] ?? d.body;
            const limit = LIMITS[d.platform] ?? 99999;
            return (
              <div key={i} className="flex gap-2 rounded-md border border-zinc-800 p-2">
                {d.media_url ? (
                  <img src={d.media_url} alt="" className="h-16 w-16 flex-none rounded object-cover" />
                ) : (
                  <span className="h-16 w-16 flex-none rounded bg-zinc-800" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1 text-sm font-medium">
                    {d.platform}
                    <Badge variant="outline">{d.kind}</Badge>
                  </div>
                  <Textarea
                    value={body}
                    onChange={(e) => setBodies((prev) => ({ ...prev, [i]: e.target.value }))}
                    className="mt-1"
                  />
                  <p className={`text-xs ${body.length > limit ? "text-red-400" : "text-zinc-500"}`}>
                    {body.length}/{limit} karakter{d.needsMedia ? " · butuh gambar" : " · link di bio"}
                  </p>
                  <div className="mt-1 flex gap-1">
                    <Button size="sm" variant="secondary" disabled={saveBusy === i} onClick={() => saveOne(i)}>
                      {saveBusy === i ? <Spinner label="Simpan…" /> : "Simpan draft ini"}
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => setConfirmPost({ i, platform: d.platform, body })}
                    >
                      Posting
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Konten tersimpan</CardTitle>
            <CardDescription>
              {filtered.length}/{rows.length} konten
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Select value={fp} onChange={(e) => setFp(e.target.value)} aria-label="filter platform">
              <option value="">Semua platform</option>
              <option value="instagram">instagram</option>
              <option value="facebook">facebook</option>
              <option value="threads">threads</option>
            </Select>
            <Select value={fs} onChange={(e) => setFs(e.target.value)} aria-label="filter status">
              <option value="">Semua status</option>
              <option value="draft">draft</option>
              <option value="published">published</option>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {!filtered.length ? (
            <p className="text-sm text-zinc-500">belum ada konten tersimpan</p>
          ) : (
            filtered.map((c) => (
              <div key={c.id} className="rounded-md border border-zinc-800 p-2">
                <div className="flex items-center gap-1 text-sm font-medium">
                  {c.platform}
                  <Badge variant={c.status === "draft" ? "secondary" : "default"}>{c.status}</Badge>
                  <Badge variant="outline">link {c.link_id}</Badge>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-xs text-zinc-400">
                  {c.body.slice(0, 160)}
                  {c.body.length > 160 ? "…" : ""}
                </p>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {confirmPost && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-lg border border-zinc-700 bg-zinc-950 p-5">
            <h3 className="mb-1 text-base font-semibold">Posting ke {confirmPost.platform}?</h3>
            <p className="mb-3 whitespace-pre-wrap text-sm text-zinc-400">
              {confirmPost.body.slice(0, 400)}
            </p>
            <p className="mb-3 text-xs text-zinc-500">{confirmPost.body.length} karakter</p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" disabled={postBusy} onClick={() => setConfirmPost(null)}>
                Batal
              </Button>
              <Button disabled={postBusy} onClick={doPost}>
                {postBusy ? <Spinner label="Posting…" /> : "Posting"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
