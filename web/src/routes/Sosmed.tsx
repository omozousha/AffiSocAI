import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Input, Select, Textarea } from "../components/ui/input";
import { Skeleton } from "../components/ui/skeleton";
import { api } from "../lib/utils";

interface Provider {
  slug: string;
  displayName: string;
  status: string;
  blockedReason?: string | null;
  capabilities: Record<string, boolean>;
}

const OPS = ["textPost", "imagePost", "videoPost", "carouselPost", "scheduledPost", "analytics"];

export default function Sosmed() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState("");
  const [text, setText] = useState("test post from AffiSocAI");
  const [mediaUrl, setMediaUrl] = useState("");
  const [mediaKind, setMediaKind] = useState("image");
  const [lastOut, setLastOut] = useState("");
  const [busyKey, setBusyKey] = useState("");

  // Flow cookie session state
  interface FlowStatus { live: boolean; count: number; earliestExpiry: string | null; daysLeft: number | null }
  const [flowSt, setFlowSt] = useState<FlowStatus | null>(null);
  const [flowBusy, setFlowBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const refreshFlow = useCallback(async () => {
    try {
      const r = await api<FlowStatus>("/api/flow/status");
      setFlowSt(r.body);
    } catch { /* silently ignore */ }
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

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 3000);
    return () => clearTimeout(t);
  }, [toast]);

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
      setToast(r.status >= 200 && r.status < 300 ? okMsg : ((r.body as { error?: string }).error || "gagal"));
      await refresh();
    } catch (e) {
      setToast(String(e));
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
        <Button
          size="sm"
          variant="ghost"
          disabled={busyKey === "run-check"}
          onClick={() =>
            run("run-check", () => api("/api/run-check"), "cek koneksi selesai")
          }
        >
          Cek koneksi IG
        </Button>
      </div>

      {toast && <p className="text-sm text-accent">{toast}</p>}

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
            <Input
              value={mediaUrl}
              onChange={(e) => setMediaUrl(e.target.value)}
              placeholder="https://example.com/image.jpg"
              className="flex-1"
              aria-label="media url"
            />
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
              <div key={p.slug} className="rounded-md border border-line p-3">
                <div className="flex items-center justify-between">
                  <b className="text-sm">{p.displayName}</b>
                  <Badge
                    variant={
                      p.status === "VERIFIED-EXECUTED"
                        ? "default"
                        : p.status === "VERIFIED-VIA-SCHEMA"
                          ? "secondary"
                          : "outline"
                    }
                  >
                    {p.status === "VERIFIED-EXECUTED"
                      ? "LIVE"
                      : p.status === "VERIFIED-VIA-SCHEMA"
                        ? "SCHEMA"
                        : "DISABLED"}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-muted">
                  {OPS.map((k) => `${k}=${p.capabilities[k] ? "✓" : "✗"}`).join(" ")}
                </p>
                {p.blockedReason && <p className="mt-1 text-xs text-red-400">{p.blockedReason}</p>}
                <div className="mt-2 flex flex-wrap gap-1">
                  {p.slug === "threads" && (
                    <>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busyKey !== ""}
                        onClick={async () => {
                          const r = await api<{ url?: string; error?: string }>(
                            "/api/providers/threads/authorize",
                          );
                          if (r.status === 200 && r.body.url) {
                            window.open(r.body.url, "_blank", "noopener");
                            setToast("tab otorisasi Threads dibuka");
                          } else {
                            setToast(r.body.error || "gagal minta URL otorisasi");
                          }
                        }}
                      >
                        Hubungkan
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busyKey !== ""}
                        onClick={() =>
                          run("threads-session", () => api("/api/providers/threads/session"), "Threads terhubung")
                        }
                      >
                        Cek koneksi
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={busyKey !== ""}
                        onClick={() =>
                          run(
                            "threads-reset",
                            () =>
                              api("/api/providers/threads/reset", {
                                method: "POST",
                                headers: { "content-type": "application/json" },
                                body: "{}",
                              }),
                            "Threads diputus",
                          )
                        }
                      >
                        Putuskan
                      </Button>
                    </>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busyKey !== "" || p.status !== "VERIFIED-EXECUTED"}
                    onClick={() =>
                      run(`account-${p.slug}`, () => api(`/api/providers/${p.slug}/account`), `akun ${p.slug} terbaca`)
                    }
                  >
                    Account
                  </Button>
                  {p.status === "VERIFIED-EXECUTED" && (
                    <Button
                      size="sm"
                      disabled={busyKey !== ""}
                      onClick={() =>
                        run(
                          `publish-${p.slug}`,
                          () =>
                            api(`/api/providers/${p.slug}/publish`, {
                              method: "POST",
                              headers: { "content-type": "application/json" },
                              body: JSON.stringify(composer()),
                            }),
                          `publish test ke ${p.slug} terkirim`,
                        )
                      }
                    >
                      Publish test
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busyKey !== ""}
                    onClick={() =>
                      run(
                        `validate-${p.slug}`,
                        () =>
                          api(`/api/providers/${p.slug}/validate`, {
                            method: "POST",
                            headers: { "content-type": "application/json" },
                            body: JSON.stringify(composer()),
                          }),
                        `payload ${p.slug} valid`,
                      )
                    }
                  >
                    Validate
                  </Button>
                </div>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted">belum ada provider.</p>
          )}
          {lastOut && (
            <details className="text-xs">
              <summary className="cursor-pointer text-muted">respons terakhir</summary>
              <pre className="mt-1 max-h-48 overflow-auto rounded bg-panel p-2">{lastOut}</pre>
            </details>
          )}
        </CardContent>
      </Card>

      {/* Google Flow Cookie Session */}
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Google Flow 🍌</CardTitle>
            <CardDescription>
              Import cookies JSON dari Chrome — Nano Banana 2 gratis ~180 hari.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {/* Status badge */}
          <div className="flex items-center gap-2">
            <Badge variant={flowSt?.live ? "default" : "outline"}>
              {flowSt?.live ? "AKTIF" : flowSt === null ? "…" : "TIDAK AKTIF"}
            </Badge>
            {flowSt?.live && (
              <span className="text-xs text-muted">
                {flowSt.count} cookies · expire {flowSt.earliestExpiry} ({flowSt.daysLeft} hari lagi)
              </span>
            )}
            {flowSt && !flowSt.live && flowSt.count > 0 && (
              <span className="text-xs text-red-400">Cookies expired — reimport.</span>
            )}
          </div>

          {/* File import */}
          <div className="flex flex-wrap gap-2 items-center">
            <input
              ref={fileRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setFlowBusy(true);
                try {
                  const text = await file.text();
                  const body = JSON.parse(text);
                  const r = await api<{ ok: boolean; count?: number; earliestExpiry?: string; error?: string }>(
                    "/api/flow/cookies",
                    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
                  );
                  if (r.status === 200) {
                    setToast(`Flow: ${r.body.count} cookies disimpan · expire ${r.body.earliestExpiry}`);
                    await refreshFlow();
                  } else {
                    setToast(r.body.error || "gagal import cookies");
                  }
                } catch (err) {
                  setToast(`Error: ${String(err)}`);
                } finally {
                  setFlowBusy(false);
                  if (fileRef.current) fileRef.current.value = "";
                }
              }}
            />
            <Button
              size="sm"
              disabled={flowBusy}
              onClick={() => fileRef.current?.click()}
            >
              {flowBusy ? "Mengimpor…" : "Import cookies JSON"}
            </Button>
            <Button size="sm" variant="ghost" disabled={flowBusy} onClick={refreshFlow}>
              Refresh status
            </Button>
            {flowSt?.live && (
              <Button
                size="sm"
                variant="destructive"
                disabled={flowBusy}
                onClick={async () => {
                  setFlowBusy(true);
                  try {
                    await api("/api/flow/cookies", { method: "DELETE" });
                    setToast("Flow session dihapus");
                    await refreshFlow();
                  } finally {
                    setFlowBusy(false);
                  }
                }}
              >
                Hapus sesi
              </Button>
            )}
          </div>

          <p className="text-xs text-muted">
            Export dari Chrome: buka flow.google.com saat login → ekstensi cookie export (mis. EditThisCookie) → Export JSON → upload di sini.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
