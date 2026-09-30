import { useCallback, useEffect, useState } from "react";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Skeleton } from "../components/ui/skeleton";
import { api } from "../lib/utils";
import {
  PLAT_LABEL,
  STATUS_LABEL,
  STATUS_VARIANT,
  wibHm,
  type Link,
  type Slot,
} from "../lib/format";

interface ScheduleBody {
  status?: {
    today?: { date?: string; published?: number; slots?: Slot[] };
    platforms?: { slug: string; ready: boolean }[];
  };
  trend?: { published?: number; failed?: number; content_queue?: number };
}

interface LinksBody {
  links?: Link[];
}

interface ProvidersBody {
  providers?: { status: string }[];
}

export default function Dashboard({ go }: { go: (r: string) => void }) {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [sched, setSched] = useState<ScheduleBody>({});
  const [links, setLinks] = useState<Link[]>([]);
  const [liveCount, setLiveCount] = useState("");
  const [platRows, setPlatRows] = useState<{ slug: string; ready: boolean }[]>([]);

  const load = useCallback(async () => {
    setErr("");
    try {
      const [s, l, p] = await Promise.all([
        api<ScheduleBody>("/api/schedule?window=7"),
        api<LinksBody>("/api/links"),
        api<ProvidersBody>("/api/providers"),
      ]);
      if (s.status >= 400) throw new Error((s.body as { error?: string }).error || "gagal muat jadwal");
      setSched(s.body);
      setLinks(l.body.links ?? []);
      setPlatRows(s.body.status?.platforms ?? []);
      const provs = p.body.providers ?? [];
      const live = provs.filter((x) => x.status === "VERIFIED-EXECUTED").length;
      setLiveCount(`${live}/${provs.length}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const today = sched.status?.today;
  const byId = new Map(links.map((l) => [l.id, l.product || l.short_url || `#${l.id}`]));
  const slots = [...(today?.slots ?? [])].sort((a, b) => a.slot_index - b.slot_index);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Dashboard</h1>
          <p className="text-sm text-zinc-400">
            Ringkasan autopilot · {today?.date ?? "hari ini"} · tiap slot posting ke semua platform aktif
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={load}>
          Muat ulang
        </Button>
      </div>

      {err && <p className="text-sm text-red-400">gagal: {err}</p>}

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Hari ini</CardTitle>
            <CardDescription>
              {today?.date ?? "—"} · {today?.published ?? 0}/{slots.length} terbit
            </CardDescription>
          </div>
          <Button variant="ghost" size="sm" onClick={() => go("jadwal")}>
            Kelola jadwal
          </Button>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {loading ? (
            <>
              <Skeleton className="h-14" />
              <Skeleton className="h-14" />
              <Skeleton className="h-14" />
            </>
          ) : slots.length ? (
            slots.map((s) => (
              <div
                key={s.id}
                className="flex items-center gap-3 rounded-md border border-zinc-800 p-3"
              >
                <div className="w-14 flex-none text-lg font-bold">
                  {wibHm(s.scheduled_for)}
                  <span className="block text-[10px] font-normal text-zinc-500">WIB</span>
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">
                    {byId.get(s.link_id ?? -1) ?? (s.link_id ? `link ${s.link_id}` : "link otomatis")}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    <Badge variant={STATUS_VARIANT[s.status] ?? "outline"}>
                      {STATUS_LABEL[s.status] ?? s.status}
                    </Badge>
                    {String(s.platform || "")
                      .split(",")
                      .map((x) => x.trim())
                      .filter(Boolean)
                      .map((n) => (
                        <Badge key={n} variant="secondary">
                          {PLAT_LABEL[n] || n}
                        </Badge>
                      ))}
                  </div>
                </div>
              </div>
            ))
          ) : (
            <p className="text-sm text-zinc-500">Belum ada slot hari ini.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Status</CardTitle>
            <CardDescription>Kesiapan platform + angka 7 hari terakhir.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {loading ? (
            <Skeleton className="h-8 w-full" />
          ) : (
            <>
              {platRows.map((p) => (
                <Badge key={p.slug} variant={p.ready ? "default" : "destructive"}>
                  {p.slug} {p.ready ? "siap" : "tidak siap"}
                </Badge>
              ))}
              <Badge variant="outline">{liveCount} provider live</Badge>
              <Badge variant="outline">{links.length} total link</Badge>
              <Badge variant="outline">{sched.trend?.published ?? 0} terbit 7h</Badge>
              <Badge variant={(sched.trend?.failed ?? 0) ? "destructive" : "outline"}>
                {sched.trend?.failed ?? 0} gagal
              </Badge>
              <Badge variant="outline">{sched.trend?.content_queue ?? 0} konten siap</Badge>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Aksi cepat</CardTitle>
            <CardDescription>Jalan pintas ke tugas harian.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button onClick={() => go("links")}>Tambah link</Button>
          <Button variant="ghost" onClick={() => go("konten")}>
            Generate konten
          </Button>
          <Button variant="ghost" onClick={() => go("jadwal")}>
            Cek jadwal
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
