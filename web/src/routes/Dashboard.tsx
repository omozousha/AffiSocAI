import { useCallback, useEffect, useState } from "react";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Skeleton } from "../components/ui/skeleton";
import { api } from "../lib/utils";
import { PLAT_LABEL } from "../lib/format";
import type { Link, Slot } from "../lib/format";
import { useToast } from "../components/ui/toast";
import { TodayCard } from "./dashboard/TodayCard";
import { InsightsCard } from "./dashboard/InsightsCard";
import { StatGrid } from "./dashboard/StatGrid";

interface ScheduleBody {
  status?: {
    enabled?: boolean;
    slot_times?: string[];
    today?: { date?: string; published?: number; slots?: Slot[] };
    platforms?: { slug: string; ready: boolean }[];
  };
  trend?: { published?: number; failed?: number; content_queue?: number };
  pool?: { total: number; usable: number; cooling: number; dead: number; no_image: number };
}

export interface InsightsBody {
  best_hours?: { hourLocal: string; posts: number; avgReach: number }[];
  suggested_times?: string[];
}

interface LinksBody {
  links?: Link[];
}

interface ProvidersBody {
  providers?: { status: string }[];
}

interface MetricRow {
  content_id: number;
  platform: string;
  metrics: Record<string, number>;
  fetched_at: string;
}
interface MetricsBody {
  metrics?: MetricRow[];
}

/** single reach-ish number for ranking (IG has reach, FB media views, threads empty) */
function reachOf(m: Record<string, number>): number {
  return m.reach ?? m.views ?? m.post_media_view ?? 0;
}

export default function Dashboard({ go }: { go: (r: string) => void }) {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [sched, setSched] = useState<ScheduleBody>({});
  const [links, setLinks] = useState<Link[]>([]);
  const [liveCount, setLiveCount] = useState("");
  const [platRows, setPlatRows] = useState<{ slug: string; ready: boolean }[]>([]);
  const [metrics, setMetrics] = useState<MetricRow[]>([]);
  const [insights, setInsights] = useState<InsightsBody>({});
  const [times, setTimes] = useState<string[]>([]);
  const toasts = useToast();

  const load = useCallback(async () => {
    setErr("");
    try {
      const [s, l, p, mx, ins] = await Promise.all([
        api<ScheduleBody>("/api/schedule?window=7"),
        api<LinksBody>("/api/links"),
        api<ProvidersBody>("/api/providers"),
        api<MetricsBody>("/api/metrics?limit=50"),
        api<InsightsBody>("/api/insights"),
      ]);
      if (s.status >= 400) throw new Error((s.body as { error?: string }).error || "gagal muat jadwal");
      setSched(s.body);
      setLinks(l.body.links ?? []);
      setPlatRows(s.body.status?.platforms ?? []);
      setTimes(s.body.status?.slot_times ?? []);
      const provs = p.body.providers ?? [];
      const live = provs.filter((x) => x.status === "VERIFIED-EXECUTED").length;
      setLiveCount(`${live}/${provs.length}`);
      setMetrics(mx.body.metrics ?? []);
      setInsights(ins.body ?? {});
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  /** P2.8 apply — writes slot_times via the existing config endpoint. */
  const applyTimes = useCallback(
    async (t: string) => {
      const r = await api<{ error?: string }>("/api/schedule/config", {
        method: "POST",
        body: JSON.stringify({ slot_times: t }),
      });
      if (r.status >= 400) toasts.toast(`gagal: ${r.body.error ?? r.status}`, "err");
      else {
        toasts.toast(`jam posting diganti → ${t}`);
        load();
      }
    },
    [load, toasts],
  );

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
          <p className="text-sm text-muted">
            Ringkasan autopilot · {today?.date ?? "hari ini"} · tiap slot posting ke semua platform aktif
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={load}>
          Muat ulang
        </Button>
      </div>

      {err && <p className="text-sm text-red-400">gagal: {err}</p>}

      <StatGrid
        links={links}
        pool={sched.pool}
        publishedToday={today?.published ?? 0}
        slotCount={slots.length}
        failed7h={sched.trend?.failed ?? 0}
        published7h={sched.trend?.published ?? 0}
      />

      <InsightsCard insights={insights} current={times} onApply={applyTimes} />

      <TodayCard
        date={today?.date ?? "—"}
        published={today?.published ?? 0}
        slots={slots}
        loading={loading}
        linkLabel={(s) => byId.get(s.link_id ?? -1) ?? (s.link_id ? `link ${s.link_id}` : "link otomatis")}
        onManage={() => go("jadwal")}
      />

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
            <CardTitle>Performa posting</CardTitle>
            <CardDescription>
              {metrics.length > 0
                ? `Metrik terkumpul otomatis tiap jam — ${metrics.length} post.`
                : "Metrik ditarik otomatis tiap jam; muncul setelah post berumur >1 jam."}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {metrics.length === 0 ? (
            <p className="text-muted-foreground text-sm">Belum ada metrik tersimpan.</p>
          ) : (
            <ul className="space-y-1.5">
              {[...metrics]
                .sort((a, b) => reachOf(b.metrics) - reachOf(a.metrics))
                .slice(0, 8)
                .map((m) => (
                  <li key={m.content_id} className="flex items-center justify-between gap-3 text-sm">
                    <span className="flex items-center gap-2 min-w-0">
                      <Badge variant="outline">{PLAT_LABEL[m.platform] ?? m.platform}</Badge>
                      <span className="truncate text-muted-foreground">
                        content #{m.content_id} · {new Date(m.fetched_at).toLocaleDateString("id-ID")}
                      </span>
                    </span>
                    <span className="shrink-0 tabular-nums">
                      jangkauan {reachOf(m.metrics)}
                      {m.metrics.comments !== undefined && m.metrics.comments > 0 && ` · kom ${m.metrics.comments}`}
                    </span>
                  </li>
                ))}
            </ul>
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
