import { useState } from "react";
import { CheckCircle2, Globe, Rocket } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { api } from "../../lib/utils";

export interface StepPublishProps {
  linkId: number;
  caption: string;
  product: string;
  shortUrl: string;
  platforms: string[];
  onFinish: () => void;
  onBack: () => void;
}

/** Step 4 — pilih platform + publish immediate. Gagal total → pesan jelas, back untuk perbaiki caption. */
export function StepPublish({ linkId, caption: _caption, product, shortUrl, platforms, onFinish, onBack }: StepPublishProps) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const publishOne = async (platform: string) => {
    setBusy(true);
    try {
      const r = await api<{ error?: string; platform?: string; content_id?: number }>(`/api/links/${linkId}/post`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ platform }),
      });
      if (r.status !== 200) throw new Error(r.body.error || `HTTP ${r.status}`);
      setDone(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      onBack(); // kembali ke caption agar bisa perbaiki, tanpa kehilangan state
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-5 border-line bg-panel/50 flex flex-col gap-4">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Rocket size={16} className="text-accent" />
        <span>Langkah 4: Terbitkan</span>
      </div>

      <div className="text-xs text-muted">Produk: <span className="text-fg">{product}</span></div>
      <div className="text-xs text-muted break-all">URL: {shortUrl}</div>

      {err && (
        <div className="text-xs text-rose-400">Publish gagal: {err}</div>
      )}

      {done ? (
        <div className="flex flex-col items-center gap-2 py-6">
          <CheckCircle2 size={34} className="text-emerald-400" />
          <p className="text-sm font-semibold">Berhasil Terbit!</p>
          <Button size="sm" variant="default" className="bg-accent text-bg hover:bg-accent/90 text-xs" onClick={onFinish}>
            Mulai Produk Baru
          </Button>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium text-fg">Platform penerbitan:</span>
            <div className="flex flex-wrap gap-2">
              {platforms.map((p) => (
                <Button
                  key={p}
                  size="sm"
                  variant="outline"
                  className="gap-1.5 text-xs capitalize"
                  onClick={() => void publishOne(p)}
                  disabled={busy}
                >
                  <Globe size={13} />
                  {p === "x" ? "X / Twitter" : p === "threads" ? "Threads" : p}
                </Button>
              ))}
            </div>
          </div>
          <p className="text-[11px] text-muted">
            Posting dikirim sekali per platform (klik tombol untuk tiap platform). Gagal di salah satu tidak
            membatalkan yang lain.
          </p>
          <Button size="sm" variant="ghost" className="self-start text-xs" onClick={onBack} disabled={busy}>
            ← Kembali Edit Caption
          </Button>
        </>
      )}
    </Card>
  );
}
