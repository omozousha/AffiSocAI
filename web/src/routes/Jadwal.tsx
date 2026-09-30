import { useCallback, useEffect, useState } from "react";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Skeleton } from "../components/ui/skeleton";
import { api } from "../lib/utils";
import {
  PLAT_LABEL,
  STATUS_LABEL,
  STATUS_VARIANT,
  wibHm,
  type BadgeVariant,
  type Slot,
} from "../lib/format";

interface StatusBody {
  enabled: boolean;
  today: { date: string; published: number; slots: Slot[] };
  next?: { id: number; slot_date: string; scheduled_for: string } | null;
  platforms: { slug: string; ready: boolean }[];
  slot_times: string[];
}

interface TrendBody {
  published: number;
  failed: number;
  content_queue: number;
  by_hour: Record<string, number>;
  top_links: { title: string; count: number }[];
}

interface SchedBody {
  status: StatusBody;
  slots?: Slot[];
  trend: TrendBody;
}

interface HealthBody {
  ok: boolean;
}

function platBadge(n: string) {
  const known = n === "instagram" || n === "facebook" || n === "threads";
  return (
    <Badge key={n} variant={known ? "default" : "outline"}>
      {PLAT_LABEL[n] || n}
    </Badge>
  );
}

export default function Jadwal() {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [st, setSt] = useState<StatusBody | null>(null);
  const [trend, setTrend] = useState<TrendBody | null>(null);
  const [tomorrow, setTomorrow] = useState<Slot[]>([]);
  const [healthy, setHealthy] = useState(false);
  const [newHm, setNewHm] = useState("");
  const [adding, setAdding] = useState(false);
  const [toast, setToast] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const d = new Date(Date.now() + 86_400_000);
      const tmr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const [s, h, t] = await Promise.all([
        api<SchedBody>("/api/schedule?window=7"),
        api<HealthBody>("/api/schedule/health"),
        api<SchedBody>(`/api/schedule?date=${tmr}`),
      ]);
      setSt(s.body.status);
      setTrend(s.body.trend);
      setTomorrow((t.body.slots ?? []).sort((a, b) => a.slot_index - b.slot_index));
      setHealthy(h.body.ok);
      setErr("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const tick = () => {
      if (!document.hidden) load();
    };
    const t = setInterval(tick, 20_000);
    const onVis = () => {
      if (!document.hidden) load();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [load]);

  const saveTimes = async (times: string[]) => {
    const r = await api("/api/schedule/config", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slot_times: times.join(",") }),
    });
    if (r.status !== 200) throw new Error((r.body as { error?: string }).error || "gagal simpan");
    await load();
  };

  const delTime = async (i: number) => {
    const times = (st?.slot_times ?? []).filter((_, k) => k !== i);
    if (!times.length) return;
    await saveTimes(times);
  };

  const addTime = async () => {
    if (!/^([01]?\d|2[0-3]):[0-5]\d$/.test(newHm.trim())) return;
    try {
      const r = await api<{ times?: string[]; lands?: string; error?: string }>("/api/schedule/add-time", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slot_time: newHm.trim() }),
      });
      if (r.status !== 200) throw new Error((r.body as { error?: string }).error || "gagal simpan");
      setToast(
        r.body.lands === "today"
          ? `jam ${newHm.trim()} masuk slot HARI INI — tick 60 detik jalan otomatis`
          : `jam ${newHm.trim()} masuk slot BESOK (waktu hari ini sudah lewat)`,
      );
      setNewHm("");
      setAdding(false);
      await load();
    } catch (e) {
      setToast(e instanceof Error ? e.message : String(e));
    }
  };

  const togglePause = async () => {
    if (!st) return;
    await api("/api/schedule/config", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: !st.enabled }),
    });
    await load();
  };

  const runSlot = async (id: number) => {
    setBusyId(id);
    try {
      const r = await api<{ slot?: { platform?: string }; error?: string }>("/api/schedule/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slot_id: id }),
      });
      if (r.status !== 200) throw new Error(r.body.error || "gagal jalankan slot");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
      await load();
    }
  };

  const slots = [...(st?.today.slots ?? [])].sort((a, b) => a.slot_index - b.slot_index);
  const nextId = st?.next && st.next.slot_date === st?.today.date ? st.next.id : null;
  const byHour = Object.entries(trend?.by_hour ?? {}).sort((a, b) => b[1] - a[1]);
  const top = Math.max(1, ...byHour.map(([, n]) => n));

  const todayLabel = (d: Date) =>
    `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
  const now = new Date();
  const range = `${todayLabel(new Date(now.getTime() - 6 * 86_400_000))} – ${todayLabel(now)}`;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Jadwal</h1>
          <p className="text-sm text-zinc-400">
            {healthy ? "aktif" : "tidak sehat"}
            {st?.next ? ` · berikutnya ${wibHm(st.next.scheduled_for)}` : ""}
            {st && !st.enabled ? " · dijeda" : ""}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={load}>
          Muat ulang
        </Button>
      </div>

      {err && <p className="text-sm text-red-400">gagal: {err}</p>}
      {toast && <p className="text-sm text-emerald-200">{toast}</p>}

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Hari ini</CardTitle>
            <CardDescription>
              {st?.today.date ?? "—"} · {st?.today.published ?? 0}/{slots.length} terbit · tiap
              slot ke semua platform aktif
            </CardDescription>
          </div>
          <Button variant="ghost" size="sm" onClick={togglePause}>
            {st?.enabled ? "Jeda" : "Lanjutkan"}
          </Button>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {loading ? (
            <>
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
            </>
          ) : slots.length ? (
            slots.map((s) => {
              const locked = s.status === "published";
              return (
                <div
                  key={s.id}
                  className={`flex items-center gap-3 rounded-md border p-3 ${
                    s.id === nextId ? "border-emerald-200" : "border-zinc-800"
                  }`}
                >
                  <div className="w-14 flex-none text-lg font-bold">
                    {wibHm(s.scheduled_for)}
                    <span className="block text-[10px] font-normal text-zinc-500">WIB</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">
                      Slot {s.slot_index + 1} · {s.link_id != null ? `link ${s.link_id}` : "link otomatis"}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      <Badge variant={(STATUS_VARIANT[s.status] ?? "outline") as BadgeVariant}>
                        {STATUS_LABEL[s.status] ?? s.status}
                      </Badge>
                      {String(s.platform || "")
                        .split(",")
                        .map((x) => x.trim())
                        .filter(Boolean)
                        .map(platBadge)}
                    </div>
                    {(s as { post_id?: string | number }).post_id && (
                      <div className="mt-1 text-xs text-zinc-500">
                        post {String((s as { post_id?: string }).post_id).slice(0, 24)}
                      </div>
                    )}
                    {(s as { error?: string }).error && (
                      <div className="mt-1 text-xs text-red-400">
                        {(s as { error?: string }).error?.slice(0, 200)}
                      </div>
                    )}
                  </div>
                  <div>
                    {locked ? (
                      <span title="sudah terbit, terkunci">🔒</span>
                    ) : (
                      <Button
                        size="sm"
                        variant={s.status === "failed" ? "secondary" : "default"}
                        disabled={busyId === s.id}
                        onClick={() => runSlot(s.id)}
                      >
                        {busyId === s.id ? "…" : s.status === "failed" ? "Coba lagi" : "Jalankan"}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })
          ) : (
            <p className="text-sm text-zinc-500">belum ada slot hari ini.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Kontrol</CardTitle>
            <CardDescription>Berlaku untuk slot besok dan seterusnya.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">{trend?.published ?? 0} terbit (7h)</Badge>
            <Badge variant={(trend?.failed ?? 0) ? "destructive" : "outline"}>
              {trend?.failed ?? 0} gagal
            </Badge>
            <Badge variant="outline">{trend?.content_queue ?? 0} konten siap</Badge>
            {(st?.platforms ?? []).map((p) => (
              <Badge key={p.slug} variant={p.ready ? "default" : "destructive"}>
                {p.slug} {p.ready ? "siap" : "tidak siap"}
              </Badge>
            ))}
          </div>
          <div>
            <div className="mb-2 text-sm font-medium">Jam posting (WIB)</div>
            <div className="flex flex-wrap items-center gap-2">
              {(st?.slot_times ?? []).map((t, i) => (
                <Badge key={t} variant="secondary" className="gap-1 text-sm">
                  {t}
                  <button
                    aria-label={`hapus jam ${t}`}
                    className="ml-1 hover:text-red-400"
                    onClick={() => delTime(i)}
                  >
                    ×
                  </button>
                </Badge>
              ))}
              {(st?.slot_times ?? []).length < 6 &&
                (adding ? (
                  <span className="flex items-center gap-1">
                    <Input
                      value={newHm}
                      onChange={(e) => setNewHm(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") addTime();
                        if (e.key === "Escape") {
                          setAdding(false);
                          setNewHm("");
                        }
                      }}
                      placeholder="HH:MM"
                      maxLength={5}
                      className="h-7 w-20"
                    />
                    <Button size="sm" onClick={addTime}>
                      ✓
                    </Button>
                  </span>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
                    + tambah jam
                  </Button>
                ))}
            </div>
            <p className="mt-1 text-xs text-zinc-500">Maksimal 6 jam. Jam baru berlaku mulai besok — lihat seksi Besok di bawah.</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Besok</CardTitle>
            <CardDescription>Slot besok — jam baru yang ditambah muncul di sini.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {loading ? (
            <Skeleton className="h-14" />
          ) : tomorrow.length ? (
            tomorrow.map((s) => (
              <div key={s.id} className="flex items-center gap-3 rounded-md border border-zinc-800 p-3">
                <div className="w-14 flex-none text-lg font-bold">
                  {wibHm(s.scheduled_for)}
                  <span className="block text-[10px] font-normal text-zinc-500">WIB</span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">Slot {s.slot_index + 1}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    <Badge variant={(STATUS_VARIANT[s.status] ?? "outline") as BadgeVariant}>
                      {STATUS_LABEL[s.status] ?? s.status}
                    </Badge>
                    {String(s.platform || "")
                      .split(",")
                      .map((x) => x.trim())
                      .filter(Boolean)
                      .map(platBadge)}
                  </div>
                </div>
              </div>
            ))
          ) : (
            <p className="text-sm text-zinc-500">belum ada slot besok.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Riwayat</CardTitle>
            <CardDescription>{range} · dari slot yang benar-benar terbit</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {byHour.length ? (
            byHour.map(([h, n]) => (
              <div key={h} className="flex items-center gap-2 text-sm">
                <span className="w-12 text-zinc-400">{((Number(h) + 7) % 24) + ":00"}</span>
                <span
                  className="h-2 rounded bg-emerald-200"
                  style={{ width: `${Math.round((n / top) * 100)}%`, minWidth: 8 }}
                />
                <b>{n}</b>
              </div>
            ))
          ) : (
            <p className="text-sm text-zinc-500">belum ada posting.</p>
          )}
          <ul className="mt-2 text-sm">
            {(trend?.top_links ?? []).slice(0, 3).map((l) => (
              <li key={l.title}>
                {l.title} <span className="text-zinc-500">×{l.count}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
