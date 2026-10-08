import { useState } from "react";
import { Link2, ArrowRight, Loader2 } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { api } from "../../lib/utils";

export interface StepLinkProps {
  onSuccess: (data: { linkId: number; product: string; imageUrl: string; shortUrl: string }) => void;
  onError: (err: string) => void;
}

export function StepLink({ onSuccess, onError }: StepLinkProps) {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [kategori, setKategori] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanUrl = url.trim();
    if (!cleanUrl) return;
    setLoading(true);
    try {
      // 1. Simpan link Shopee
      const addRes = await api<{
        total?: number;
        added?: number;
        rejected?: number;
        error?: string;
        results?: Array<{
          link_id?: number;
          product?: string | null;
          image_url?: string | null;
          status?: string;
          reason?: string;
        }>;
      }>("/api/links", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ short_url: cleanUrl, kategori: kategori.trim() || undefined }),
      });

      if (addRes.status !== 200 && addRes.status !== 201) {
        throw new Error(addRes.body.error || `Gagal menyimpan link (HTTP ${addRes.status})`);
      }

      const resItem = addRes.body.results?.[0];
      const linkId = resItem?.link_id;
      if (!linkId) {
        // Fallback: ambil link terbaru jika list returned tanpa item atau format non-standar
        const listRes = await api<{ links: Array<{ id: number; product?: string; image_url?: string; short_url?: string }> }>("/api/links");
        const match = listRes.body.links?.find((l) => l.short_url === cleanUrl) || listRes.body.links?.[0];
        if (!match) throw new Error("Link tersimpan tapi ID tidak ditemukan");
        
        let prod = match.product || "Produk Shopee";
        let img = match.image_url || "";
        if (!img) {
          const enrichRes = await api<{ error?: string; product?: string; image_url?: string }>(`/api/links/${match.id}/enrich`, {
            method: "POST",
          });
          if (enrichRes.status === 200 && enrichRes.body.image_url) {
            prod = enrichRes.body.product || prod;
            img = enrichRes.body.image_url;
          }
        }
        onSuccess({ linkId: match.id, product: prod, imageUrl: img, shortUrl: cleanUrl });
        return;
      }

      let product = resItem.product || "Produk Shopee";
      let imageUrl = resItem.image_url || "";

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
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
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

        <Button
          type="submit"
          disabled={loading || !url.trim()}
          className="mt-2 flex items-center justify-center gap-2 bg-accent text-bg hover:bg-accent/90 text-xs font-medium py-2"
        >
          {loading ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              <span>Memproses Link & Enrich Data…</span>
            </>
          ) : (
            <>
              <span>Lanjut ke Review Gambar</span>
              <ArrowRight size={14} />
            </>
          )}
        </Button>
      </form>
    </Card>
  );
}
