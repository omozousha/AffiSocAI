import { useCallback, useEffect, useState } from "react";
import { Button } from "../components/ui/button";
import { useToast } from "../components/ui/toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Input, Select, Textarea } from "../components/ui/input";
import { Skeleton } from "../components/ui/skeleton";
import { Empty } from "../components/ui/empty";
import { api } from "../lib/utils";
import { FlowPanel, type FlowStatus } from "./sosmed/FlowPanel";
import { ProviderCard, type Provider } from "./sosmed/ProviderCard";

export default function Sosmed() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  const [text, setText] = useState("test post from AffiSocAI");
  const [mediaUrl, setMediaUrl] = useState("");
  const [mediaKind, setMediaKind] = useState("image");
  const [lastOut, setLastOut] = useState("");
  const [busyKey, setBusyKey] = useState("");
  const [flowSt, setFlowSt] = useState<FlowStatus | null>(null);

  const refreshFlow = useCallback(async () => {
    try {
      const r = await api<FlowStatus>("/api/flow/status");
      setFlowSt(r.body);
    } catch {
      /* silently ignore */
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const r = await api<{ providers?: Provider[] }>("/api/providers");
      setProviders(r.body.providers || []);
    } catch {
      /* panel tampil apa adanya */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    refreshFlow();
  }, [refresh, refreshFlow]);

  const composer = () => ({
    text: text || "test post from AffiSocAI",
    mediaUrl: mediaUrl || undefined,
    mediaKind,
  });

  const run = async (key: string, fn: () => Promise<{ status: number; body: unknown }>, okMsg: string) => {
    setBusyKey(key);
    try {
      const r = await fn();
      setLastOut(JSON.stringify({ status: r.status, body: r.body }, null, 2));
      const ok = r.status >= 200 && r.status < 300;
      toast(ok ? okMsg : (r.body as { error?: string }).error || "gagal", ok ? "ok" : "err");
      await refresh();
    } catch (e) {
      toast(String(e), "err");
    } finally {
      setBusyKey("");
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Sosmed</h1>
          <p className="text-sm text-muted">Composer &amp; status provider. IG/FB link tetap di bio.</p>
        </div>
        <Button size="sm" variant="ghost" disabled={busyKey === "run-check"} onClick={() => run("run-check", () => api("/api/run-check"), "cek koneksi selesai")}>
          Cek koneksi IG
        </Button>
      </div>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Composer</CardTitle>
            <CardDescription>Payload untuk publish test / validate.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <Textarea value={text} onChange={(e) => setText(e.target.value)} aria-label="caption" />
          <div className="flex gap-2 max-sm:flex-col">
            <Input value={mediaUrl} onChange={(e) => setMediaUrl(e.target.value)} placeholder="https://example.com/image.jpg" className="flex-1" aria-label="media url" />
            <Select value={mediaKind} onChange={(e) => setMediaKind(e.target.value)} aria-label="media kind">
              <option value="image">image</option>
              <option value="video">video</option>
              <option value="carousel">carousel</option>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Provider</CardTitle>
            <CardDescription>Koneksi tiap platform + publish test.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {loading ? (
            <>
              <Skeleton className="h-20" />
              <Skeleton className="h-20" />
              <Skeleton className="h-20" />
            </>
          ) : providers.length ? (
            providers.map((p) => (
              <ProviderCard
                key={p.slug}
                p={p}
                busy={busyKey !== ""}
                composer={composer}
                onRun={run}
                onOpenAuth={(url) => window.open(url, "_blank", "noopener")}
              />
            ))
          ) : (
            <Empty title="Belum ada provider" desc="Hubungkan akun sosial media untuk mulai posting otomatis." />
          )}
          {lastOut && (
            <details className="text-xs">
              <summary className="cursor-pointer text-muted">respons terakhir</summary>
              <pre className="mt-1 num max-h-48 overflow-auto rounded bg-panel p-2">{lastOut}</pre>
            </details>
          )}
        </CardContent>
      </Card>

      <FlowPanel flowSt={flowSt} refreshFlow={refreshFlow} />
    </div>
  );
}
