import { useCallback, useEffect, useState } from "react";
import { CalendarDays, Plus } from "lucide-react";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { useToast } from "../components/ui/toast";
import { Calendar } from "../components/ui/calendar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "../components/ui/popover";
import { Skeleton } from "../components/ui/skeleton";
import { api } from "../lib/utils";
import { wibHm, type Slot } from "../lib/format";
import { AddTimeDialog } from "./jadwal/AddTimeDialog";
import { SlotRow } from "./jadwal/SlotRow";

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

export default function Jadwal() {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [st, setSt] = useState<StatusBody | null>(null);
  const [trend, setTrend] = useState<TrendBody | null>(null);
  const [tomorrow, setTomorrow] = useState<Slot[]>([]);
  const [healthy, setHealthy] = useState(false);
  const [newHm, setNewHm] = useState("");
  const [open, setOpen] = useState(false);
  const [pickDate, setPickDate] = useState<Date | undefined>(undefined);
  const [jumpLabel, setJumpLabel] = useState("Besok");
  const { toast } = useToast();
  const [busyId, setBusyId] = useState<number | null>(null);
  const [savingTime, setSavingTime] = useState(false);

  const todayKey = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const keyOf = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

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

  /** Client-side preview: today if still ahead (WIB), else tomorrow — mirrors backend addSlotTime. */
  const landsPreview = (hhmm: string): "today" | "tomorrow" => {
    const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
    if (!m) return "tomorrow";
    const now = new Date();
    const wib = new Date(now.getTime() + (7 * 60 + now.getTimezoneOffset()) * 60_000);
    const target = new Date(wib);
    target.setHours(Number(m[1]), Number(m[2]), 0, 0);
    return target.getTime() > wib.getTime() + 60_000 ? "today" : "tomorrow";
  };

  const hmValid = /^([01]?\d|2[0-3]):[0-5]\d$/.test(newHm.trim());

  const addTime = async () => {
    if (!hmValid || savingTime) return;
    setSavingTime(true);
    try {
      const r = await api<{ times?: string[]; lands?: string; error?: string }>("/api/schedule/add-time", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slot_time: newHm.trim() }),
      });
      if (r.status !== 200) throw new Error((r.body as { error?: string }).error || "gagal simpan");
      toast(
        r.body.lands === "today"
          ? `jam ${newHm.trim()} masuk slot HARI INI — tick 60 detik jalan otomatis`
          : `jam ${newHm.trim()} masuk slot BESOK (waktu hari ini sudah lewat)`,
      );
      setNewHm("");
      setOpen(false);
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingTime(false);
    }
  };

  /** Jump to a date: loads that day's slots into the Besok panel. */
  const jumpDate = async (d: Date | undefined) => {
    setPickDate(d);
    if (!d) return;
    try {
      const t = await api<SchedBody>(`/api/schedule?date=${keyOf(d)}`);
      setTomorrow((t.body.slots ?? []).sort((a, b) => a.slot_index - b.slot_index));
      setJumpLabel(keyOf(d) === todayKey() ? "Hari ini" : keyOf(d));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
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
          <p className="text-sm text-muted">
            {healthy ? "aktif" : "tidak sehat"}
            {st?.next ? ` · berikutnya ${wibHm(st.next.scheduled_for)}` : ""}
            {st && !st.enabled ? " · dijeda" : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm">
                <CalendarDays className="mr-1 h-4 w-4" />
                {pickDate ? keyOf(pickDate) : "Pilih tanggal"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <Calendar mode="single" selected={pickDate} onSelect={jumpDate} />
            </PopoverContent>
          </Popover>
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus className="mr-1 h-4 w-4" />
            Tambah jam
          </Button>
          <AddTimeDialog
            open={open}
            onOpenChange={setOpen}
            value={newHm}
            onValue={setNewHm}
            valid={hmValid}
            saving={savingTime}
            lands={landsPreview}
            onAdd={addTime}
          />
          <Button variant="ghost" size="sm" onClick={load}>
            Muat ulang
          </Button>
        </div>
      </div>

      {err && <p className="text-sm text-red-400">gagal: {err}</p>}

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
            slots.map((s) => (
              <SlotRow key={s.id} s={s} isNext={s.id === nextId} busyId={busyId} onRun={runSlot} />
            ))
          ) : (
            <p className="text-sm text-muted">belum ada slot hari ini.</p>
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
        <CardContent className="flex flex-col gap-2">
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
              {(st?.slot_times ?? []).length < 6 && (
                <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
                  + tambah jam
                </Button>
              )}
            </div>
            <p className="mt-1 text-xs text-muted">Maksimal 6 jam. Jam baru berlaku mulai besok — lihat seksi Besok di bawah.</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>{jumpLabel}</CardTitle>
            <CardDescription>
              {jumpLabel === "Besok"
                ? "Slot besok — jam baru yang ditambah muncul di sini."
                : `Slot tanggal ${jumpLabel} — pilih tanggal lain dari kalender di atas.`}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {loading ? (
            <Skeleton className="h-14" />
          ) : tomorrow.length ? (
            tomorrow.map((s) => (
              <SlotRow key={s.id} s={s} compact />
            ))
          ) : (
            <p className="text-sm text-muted">belum ada slot besok.</p>
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
                <span className="w-12 text-muted">{((Number(h) + 7) % 24) + ":00"}</span>
                <span
                  className="h-2 rounded bg-accent"
                  style={{ width: `${Math.round((n / top) * 100)}%`, minWidth: 8 }}
                />
                <b>{n}</b>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted">belum ada posting.</p>
          )}
          <ul className="mt-2 text-sm">
            {(trend?.top_links ?? []).slice(0, 3).map((l) => (
              <li key={l.title}>
                {l.title} <span className="text-muted">×{l.count}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
