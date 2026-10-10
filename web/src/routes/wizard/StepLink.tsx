import { useState } from "react";
import { Link2 } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { ProgressBar } from "../../components/ui/progress-bar";
import { api } from "../../lib/utils";
import { postSSE } from "../../lib/sse";

export interface StepLinkProps {
  onSuccess: (data: { linkId: number; product: string; imageUrl: string; shortUrl: string }) => void;
  onError: (err: string) => void;
}

type ResultItem = {
  link_id?: number;
  product?: string | null;
  image_url?: string | null;
  status?: string;
  reason?: string;
};

/** Langkah 1 wizard: simpan link + progress bar live (SSE). */
export function StepLink({ onSuccess, onError }: StepLinkProps) {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [kategori, setKategori] = useState("");
  const [prog, setProg] = useState<{ percent: number; label: string } | null>(null);

  const finish = async (item: ResultItem | undefined, cleanUrl: string) => {
    if (!item) {
      // fallback: link mungkin sudah tersimpan (duplicate) — cari by short_url
      const listRes = await api<{ links: Array<{ id: number; product?: string; image_url?: string; short_url?: string }> }>("/api/links");
      const match = listRes.body.links?.find((l) => l.short_url === cleanUrl) || listRes.body.links?.[0];
      if (!match) {
        onError("Link tersimpan tapi ID tidak ditemukan");
        return;
      }
      onSuccess({ linkId: match.id, product: match.product || "Produk Shopee", imageUrl: match.image_url || "", shortUrl: cleanUrl });
      return;
    }
    if (item.status === "rejected") {
      onError(item.reason || "Link ditolak");
      return;
    }
    let linkId = item.link_id as number;
    let product = item.product || "Produk Shopee";
    let imageUrl = item.image_url || "";

    if (!imageUrl) {
      const enrichRes = await api<{ error?: string; product?: string; image_url?: string }>(`/api/links/${linkId}/enrich`, {
        method: "POST",
      });
      if (enrichRes.status === 200) {
        product = enrichRes.body.product || product;
        imageUrl = enrichRes.body.image_url || imageUrl;
      }
    }
    onSuccess({ linkId, product, imageUrl, shortUrl: cleanUrl });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanUrl = url.trim();
    if (!cleanUrl) return;
    setLoading(true);
    setProg({ percent: 0, label: "Menyiapkan…" });
    let done: ResultItem | undefined;
    try {
      await postSSE(
        "/api/links/stream",
        { short_url: cleanUrl, ...(kategori.trim() ? { kategori: kategori.trim() } : {}) },
        (ev) => {
          if (ev.event === "step") setProg((p) => ({ percent: p?.percent ?? 0, label: ev.data.label }));
          else if (ev.event === "progress") setProg({ percent: ev.data.percent, label: ev.data.label || "Tersimpan…" });
          else if (ev.event === "done") {
            done = (ev.data.results as ResultItem[])?.[0];
            if (done?.status === "duplicate") {
              // link sudah ada — lanjut dengan data existing
              onSuccess({
                linkId: done.link_id!,
                product: done.product || "Produk Shopee",
                imageUrl: done.image_url || "",
                shortUrl: cleanUrl,
              });
            }
          } else if (ev.event === "error") throw new Error(ev.data.error || "gagal");
        },
      );
      if (done?.status !== "duplicate") await finish(done, cleanUrl);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      setProg(null);
    }
  };

  return (
    <Card className="p-5 border-line bg-panel/50 flex flex-col gap-4">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Link2 size={16} className="text-accent" />
        <span>Langkah 1: Rekatkan Tautan Shopee</span>
      </div>
      <p className="text-xs text-muted leading-relaxed">
        Masukkan tautan affiliate Shopee (contoh: <code className="text-accent font-mono">https://s.shopee.co.id/...</code>).
        Sistem akan otomatis mengekstrak informasi produk, foto katalog, dan kategori.
      </p>

      <form onSubmit={submit} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="shopee-url" className="text-xs font-medium text-fg">
            URL Shopee <span className="text-rose-400">*</span>
          </label>
          <input
            id="shopee-url"
            type="url"
            required
            placeholder="https://s.shopee.co.id/..."
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={loading}
            className="w-full rounded-md border border-line bg-bg px-3 py-2 text-xs text-fg focus:border-accent focus:outline-none"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="shopee-kat" className="text-xs font-medium text-fg">
            Kategori (Opsional)
          </label>
          <input
            id="shopee-kat"
            type="text"
            placeholder="Fashion, Otomotif, Gadget, etc."
            value={kategori}
            onChange={(e) => setKategori(e.target.value)}
            disabled={loading}
            className="w-full rounded-md border border-line bg-bg px-3 py-2 text-xs text-fg focus:border-accent focus:outline-none"
          />
        </div>

        {prog && <ProgressBar percent={prog.percent} label={prog.label} />}

        <Button
          type="submit"
          disabled={loading || !url.trim()}
          className="mt-2 flex items-center justify-center gap-2 bg-accent"
        >
          {loading ? "Memproses…" : "Proses Tautan →"}
        </Button>
      </form>
    </Card>
  );
}
