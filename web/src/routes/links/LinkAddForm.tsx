import { useState } from "react";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { Input, Textarea } from "../../components/ui/input";
import { ProgressBar } from "../../components/ui/progress-bar";
import { Spinner } from "../../components/ui/spinner";
import { useToast } from "../../components/ui/toast";
import { postSSE } from "../../lib/sse";

type Progress = { percent: number; label: string; sub?: string };

/** Kartu tambah link: blob URL + kategori + dry-run/save. State lokal form.
 *  Save pakai SSE (POST /api/links/stream): progress % + label "sedang apa" live. */
export function LinkAddForm({ onSaved }: { onSaved: () => void }) {
  const { toast } = useToast();
  const [blob, setBlob] = useState("");
  const [kategori, setKategori] = useState("");
  const [formBusy, setFormBusy] = useState(false);
  const [dryOut, setDryOut] = useState("");
  const [prog, setProg] = useState<Progress | null>(null);

  const parseBlob = () => blob.split(/[\n,;\s]+/).map((s) => s.trim()).filter(Boolean);

  const doDry = async () => {
    const items = parseBlob();
    if (!items.length) {
      toast("isi link dulu", "err");
      return;
    }
    setFormBusy(true);
    setProg({ percent: 0, label: "Cek data produk (dry-run)…" });
    try {
      const r = await fetch("/api/links", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ links: items, ...(kategori ? { kategori } : {}), dryRun: true }),
      });
      const j = (await r.json()) as { results?: { status: string }[]; error?: string };
      const res = j.results || [];
      const ok = res.filter((x) => x.status !== "rejected").length;
      setDryOut(`${ok}/${res.length} siap (dry-run, belum disimpan)`);
    } catch (e) {
      setDryOut(`gagal: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setFormBusy(false);
      setProg(null);
    }
  };

  const doSave = async () => {
    const items = parseBlob();
    if (!items.length) {
      toast("isi link dulu", "err");
      return;
    }
    setFormBusy(true);
    setProg({ percent: 0, label: "Menyiapkan…" });
    try {
      await postSSE("/api/links/stream", { links: items.join("\n"), ...(kategori ? { kategori } : {}) }, (ev) => {
        if (ev.event === "start") {
          setProg({ percent: 0, label: `Memproses ${ev.data.total} link…` });
        } else if (ev.event === "step") {
          setProg((p) => ({ ...p, percent: p?.percent ?? 0, label: ev.data.label }));
        } else if (ev.event === "progress") {
          setProg({
            percent: ev.data.percent,
            label: ev.data.label || `Link ${ev.data.index}/${ev.data.total} selesai`,
            sub: ev.data.short_url,
          });
        } else if (ev.event === "done") {
          const d = ev.data as { added?: number; updated?: number; duplicate?: number; rejected?: number };
          toast(`${d.added ?? 0} baru, ${d.updated ?? 0} update, ${d.duplicate ?? 0} duplikat, ${d.rejected ?? 0} ditolak`);
        } else if (ev.event === "error") {
          throw new Error(ev.data.error || "gagal");
        }
      });
      setBlob("");
      setDryOut("");
      onSaved();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "err");
    } finally {
      setFormBusy(false);
      setProg(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Tambah link</CardTitle>
          <CardDescription>Link Shopee → cek data produk + gambar → simpan. Progress live per langkah.</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <Textarea value={blob} onChange={(e) => setBlob(e.target.value)} placeholder="https://s.shopee.co.id/xxxxxxx" />
        <Input value={kategori} onChange={(e) => setKategori(e.target.value)} placeholder="Kategori (opsional)" />
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" disabled={formBusy} onClick={doDry}>
            {formBusy ? <Spinner label="Cek…" /> : "Cek data (dry-run)"}
          </Button>
          <Button size="sm" disabled={formBusy} onClick={doSave}>
            {formBusy ? <Spinner label="Simpan…" /> : "Simpan & append ke sheet"}
          </Button>
        </div>
        {prog && <ProgressBar percent={prog.percent} label={prog.label} sub={prog.sub} />}
        {dryOut && <p className="text-xs text-muted">{dryOut}</p>}
      </CardContent>
    </Card>
  );
}
