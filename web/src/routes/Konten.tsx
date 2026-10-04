import { useCallback, useEffect, useState } from "react";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { useToast } from "../components/ui/toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Input, Select } from "../components/ui/input";
import { Spinner } from "../components/ui/spinner";
import { Empty } from "../components/ui/empty";
import { api } from "../lib/utils";
import { DraftCard, PostConfirmModal, type Draft } from "./konten/DraftCard";

const POST_PLATS = ["instagram", "facebook", "threads"];

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

export default function Konten() {
  const [linkOpts, setLinkOpts] = useState<LinkOpt[]>([]);
  const [linkId, setLinkId] = useState("");
  const [plats, setPlats] = useState<string[]>([...POST_PLATS]);
  const [mode, setMode] = useState("mystery");
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [cap, setCap] = useState(50);
  const [bodies, setBodies] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [saveBusy, setSaveBusy] = useState<number | null>(null);
  const [postBusy, setPostBusy] = useState(false);
  const { toast } = useToast();
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

  const togglePlat = (p: string) => {
    setPlats((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
  };

  const doGen = async () => {
    const id = Number(linkId);
    if (!id) {
      toast("isikan Link ID dulu", "err");
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
        toast(r.body.error || "generate gagal", "err");
        return;
      }
      setDrafts(r.body.drafts || []);
      setBodies({});
      toast(`${(r.body.drafts || []).length} draft dibuat`);
    } catch (e) {
      toast(String(e), "err");
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
      const ok = r.status === 200 || r.status === 201;
      toast(ok ? "draft disimpan" : "simpan gagal", ok ? "ok" : "err");
      loadRows();
    } finally {
      setSaveBusy(null);
    }
  };

  const saveAll = async () => {
    if (!drafts.length) {
      toast("belum ada draft", "err");
      return;
    }
    setBusy(true);
    try {
      for (let i = 0; i < drafts.length; i++) await submitDraft(i);
      toast(`${drafts.length} draft disimpan`);
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
      const ok = r.status === 200;
      toast(ok ? `terbit: ${r.body.platform || confirmPost.platform}` : r.body.error || "posting gagal", ok ? "ok" : "err");
    } catch (e) {
      toast(String(e), "err");
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
          <p className="text-sm text-muted">Generate caption per platform → simpan draft (link tetap di bio)</p>
        </div>
        <Button size="sm" variant="ghost" onClick={loadRows}>
          Refresh
        </Button>
      </div>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Generate</CardTitle>
            <CardDescription>Mystery: nama produk disembunyikan. Direct: nama disebut.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <Input value={linkId} onChange={(e) => setLinkId(e.target.value)} placeholder="Link ID (mis. 15)" inputMode="numeric" className="w-36" />
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
          {drafts.map((d, i) => (
            <DraftCard
              key={i}
              d={d}
              body={bodies[i] ?? d.body}
              onBody={(v) => setBodies((prev) => ({ ...prev, [i]: v }))}
              saveBusy={saveBusy === i}
              onSave={() => saveOne(i)}
              onPost={() => setConfirmPost({ i, platform: d.platform, body: bodies[i] ?? d.body })}
            />
          ))}
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
            <Empty title="Belum ada konten" desc="Generate caption di atas, lalu simpan sebagai draft — posting terjadwal memakainya." />
          ) : (
            <>
              {filtered.slice(0, cap).map((c) => (
                <div key={c.id} className="rounded-md border border-line p-2">
                  <div className="flex items-center gap-1 text-sm font-medium">
                    {c.platform}
                    <Badge variant={c.status === "draft" ? "secondary" : "default"}>{c.status}</Badge>
                    <Badge variant="outline">link {c.link_id}</Badge>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-xs text-muted">
                    {c.body.slice(0, 160)}
                    {c.body.length > 160 ? "…" : ""}
                  </p>
                </div>
              ))}
              {filtered.length > cap && (
                <Button size="sm" variant="ghost" className="w-full" onClick={() => setCap((c) => c + 50)}>
                  Muat lebih banyak (sisa {filtered.length - cap})
                </Button>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {confirmPost && (
        <PostConfirmModal
          platform={confirmPost.platform}
          body={confirmPost.body}
          busy={postBusy}
          onCancel={() => setConfirmPost(null)}
          onConfirm={doPost}
        />
      )}
    </div>
  );
}
