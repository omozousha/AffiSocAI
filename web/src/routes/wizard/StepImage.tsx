import { useEffect, useRef, useState } from "react";
import { ArrowRight, ImageIcon, RefreshCw } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { api } from "../../lib/utils";
import { MAX_REGEN } from "./wizard-machine";

export interface StepImageProps {
  linkId: number;
  product: string;
  imageUrl: string;
  regenCount: number;
  onDone: (imageUrl: string) => void;
  onSkip: () => void;
  onError: (err: string) => void;
  onRegen: () => void;
}

type JobState = "idle" | "running" | "done" | "failed";

/** Step 2 — recreate product image via AI; auto-retry ≤ MAX_REGEN, fallback foto asli. */
export function StepImage({ linkId, product, imageUrl, regenCount, onDone, onSkip, onError, onRegen }: StepImageProps) {
  const [job, setJob] = useState<JobState>("idle");
  const [newUrl, setNewUrl] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    return () => {
      cancelled.current = true;
    };
  }, []);

  const runJob = async () => {
    setJob("running");
    setElapsed(0);
    const t = setInterval(() => setElapsed((s) => s + 5), 5000);
    try {
      const start = await api<{ jobId?: string; error?: string }>(`/api/links/${linkId}/recreate-image`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      if (cancelled.current) return;
      if (!start.body.jobId) throw new Error(start.body.error || "job tidak dimulai");
      let finalUrl: string | null = null;
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 5000));
        if (cancelled.current) return;
        const p = await api<{
          status: string;
          result?: { ok?: boolean; live?: boolean; image_url?: string; error?: string };
        }>(`/api/links/${linkId}/recreate-image/status?jobId=${start.body.jobId}`);
        if (p.body.status === "running") continue;
        if (p.body.status === "done" && p.body.result?.ok) {
          finalUrl = p.body.result.image_url ?? null;
          break;
        }
        const reason = p.body.result?.error || p.body.status;
        // REJECT / gagal → auto regen selama kuota sisa (parity STRICT REDRAW scheduler)
        if (regenCount < MAX_REGEN) {
          onRegen();
          void runJob();
          return;
        }
        throw new Error(`generate ditolak: ${reason}`);
      }
      if (cancelled.current) return;
      if (finalUrl) {
        setNewUrl(finalUrl);
        setJob("done");
      } else {
        throw new Error("job selesai tanpa gambar — pakai foto asli atau lewati");
      }
    } catch (e) {
      if (!cancelled.current) {
        setJob("failed");
        onError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      clearInterval(t);
    }
  };

  useEffect(() => {
    if (job === "idle") void runJob();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job]);

  const shown = newUrl || imageUrl;

  return (
    <Card className="p-5 border-line bg-panel/50 flex flex-col gap-4">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <ImageIcon size={16} className="text-accent" />
        <span>Langkah 2: Gambar Produk (AI)</span>
      </div>

      {job === "running" && (
        <div className="flex items-center gap-2 text-xs text-muted">
          <RefreshCw size={13} className="animate-spin text-accent" />
          <span>Generate gambar untuk “{product}”… {elapsed}s (percobaan {regenCount + 1}/{MAX_REGEN + 1})</span>
        </div>
      )}

      {job === "idle" && <div className="text-xs text-muted">Menyiapkan job…</div>}

      {shown && (job === "done" || job === "failed" || job === "idle") && (
        <div className="flex flex-col gap-2">
          <img
            src={shown}
            alt={product}
            className="max-h-72 w-full rounded-md border border-line object-cover"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
          <p className="text-[11px] text-muted">
            {newUrl ? "Gambar AI baru — review sebelum lanjut." : "Foto asli produk (AI gagal/tidak dipakai)."}
          </p>
        </div>
      )}

      {job === "failed" && (
        <div className="text-xs text-rose-400">
          Generate gagal. Pilihan: coba lagi manual, atau lanjut dengan foto asli (Skip).
        </div>
      )}

      <div className="flex gap-2">
        {job === "failed" && regenCount < MAX_REGEN && (
          <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={runJob}>
            <RefreshCw size={13} /> Coba Lagi
          </Button>
        )}
        <Button
          size="sm"
          variant="default"
          className="gap-1.5 bg-accent text-bg hover:bg-accent/90 text-xs flex-1 justify-center"
          onClick={() => onDone(newUrl || imageUrl)}
          disabled={!shown || job === "running"}
        >
          <span>Terima Gambar</span>
          <ArrowRight size={13} />
        </Button>
        <Button size="sm" variant="ghost" className="text-xs" onClick={onSkip} disabled={job === "running"}>
          Pakai Foto Asli
        </Button>
      </div>
    </Card>
  );
}
