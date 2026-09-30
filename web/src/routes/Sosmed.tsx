import { useCallback, useEffect, useState } from "react";
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
  const [text, setText] = useState("test post from affiliate-tools");
  const [mediaUrl, setMediaUrl] = useState("");
  const [mediaKind, setMediaKind] = useState("image");
  const [lastOut, setLastOut] = useState("");
  const [busyKey, setBusyKey] = useState("");

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
  }, [refresh]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const composer = () => ({
    text: text || "test post from affiliate-tools",
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
          <p className="text-sm text-zinc-400">Composer &amp; status provider. IG/FB link tetap di bio.</p>
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

      {toast && <p className="text-sm text-emerald-200">{toast}</p>}

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
              <div key={p.slug} className="rounded-md border border-zinc-800 p-3">
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
                <p className="mt-1 text-xs text-zinc-500">
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
            <p className="text-sm text-zinc-500">belum ada provider.</p>
          )}
          {lastOut && (
            <details className="text-xs">
              <summary className="cursor-pointer text-zinc-400">respons terakhir</summary>
              <pre className="mt-1 max-h-48 overflow-auto rounded bg-zinc-900 p-2">{lastOut}</pre>
            </details>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
