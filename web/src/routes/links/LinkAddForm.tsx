import { useState } from "react";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { Input, Textarea } from "../../components/ui/input";
import { Spinner } from "../../components/ui/spinner";
import { useToast } from "../../components/ui/toast";
import { api } from "../../lib/utils";

/** Kartu tambah link: blob URL + kategori + dry-run/save. State lokal form. */
export function LinkAddForm({ onSaved }: { onSaved: () => void }) {
  const { toast } = useToast();
  const [blob, setBlob] = useState("");
  const [kategori, setKategori] = useState("");
  const [formBusy, setFormBusy] = useState(false);
  const [dryOut, setDryOut] = useState("");

  const parseBlob = () => blob.split(/[\n,;\s]+/).map((s) => s.trim()).filter(Boolean);

  const post = (dryRun: boolean) =>
    api<{ results?: { status: string }[]; error?: string }>("/api/links", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ links: parseBlob(), ...(kategori ? { kategori } : {}), ...(dryRun ? { dryRun: true } : {}) }),
    });

  const doDry = async () => {
    const items = parseBlob();
    if (!items.length) {
      toast("isi link dulu", "err");
      return;
    }
    setFormBusy(true);
    try {
      const r = await post(true);
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
      toast("isi link dulu", "err");
      return;
    }
    setFormBusy(true);
    try {
      const r = await post(false);
      if (r.status >= 200 && r.status < 300) {
        const n = r.body.results?.filter((x) => x.status !== "rejected").length ?? items.length;
        toast(`${n} link tersimpan`);
        setBlob("");
        setDryOut("");
        onSaved();
      } else {
        toast(r.body.error || "gagal menyimpan", "err");
      }
    } catch (e) {
      toast(String(e), "err");
    } finally {
      setFormBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Tambah link</CardTitle>
          <CardDescription>Link Shopee → cek data produk + gambar → simpan.</CardDescription>
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
        {dryOut && <p className="text-xs text-muted">{dryOut}</p>}
      </CardContent>
    </Card>
  );
}
