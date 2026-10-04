import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Skeleton } from "../components/ui/skeleton";
import { api } from "../lib/utils";

interface LogRow {
  id?: number;
  ts?: string;
  level: string;
  event: string;
  source?: string;
  method?: string;
  path?: string;
  status?: number | null;
  duration_ms?: number | null;
  message?: string;
  meta?: { tool?: string; query?: string } | null;
}

interface LogsBody {
  rows?: LogRow[];
  next_offset?: number | null;
  stats?: { total: number; error: number; warn: number; info: number; last_hour: number };
}

const LEVELS = ["info", "warn", "error"];

export default function Logs() {
  const [rows, setRows] = useState<LogRow[]>([]);
  const [stats, setStats] = useState({ total: 0, error: 0, warn: 0, info: 0, last_hour: 0 });
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [level, setLevel] = useState("");
  const [q, setQ] = useState("");
  const [qInput, setQInput] = useState("");
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [live, setLive] = useState(true);
  const rowsRef = useRef<LogRow[]>([]);
  rowsRef.current = rows;

  const load = useCallback(async (reset: boolean, curLevel: string, curQ: string, offset: number) => {
    const params = new URLSearchParams({ limit: "200", offset: String(offset) });
    if (curLevel) params.set("level", curLevel);
    if (curQ) params.set("search", curQ);
    try {
      const r = await api<LogsBody>(`/api/logs?${params}`);
      if (r.status >= 400) throw new Error((r.body as { error?: string }).error || `HTTP ${r.status}`);
      const fresh = r.body.rows || [];
      setRows((prev) => (reset ? fresh : [...prev, ...fresh]));
      if (r.body.stats) setStats(r.body.stats);
      setNextOffset(r.body.next_offset ?? null);
      setErr("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // Muat ulang saat filter berubah.
  useEffect(() => {
    setLoading(true);
    load(true, level, q, 0);
  }, [level, q, load]);

  // Live tail SSE — filter ikut state terbaru via closure deps.
  useEffect(() => {
    if (!live) return;
    const es = new EventSource("/api/logs/stream");
    es.onmessage = (ev) => {
      try {
        const r = JSON.parse(ev.data) as LogRow;
        if (level && r.level !== level) return;
        if (q) {
          const hay = `${r.path || ""}${r.message || ""}${r.event || ""}${JSON.stringify(r.meta || {})}`.toLowerCase();
          if (!hay.includes(q.toLowerCase())) return;
        }
        setRows((prev) => [r, ...prev].slice(0, 500));
        setStats((prev) => ({
          ...prev,
          total: prev.total + 1,
          last_hour: prev.last_hour + 1,
          error: prev.error + (r.level === "error" ? 1 : 0),
          warn: prev.warn + (r.level === "warn" ? 1 : 0),
        }));
      } catch {
        /* abaikan frame rusak */
      }
    };
    es.onerror = () => setLive(false);
    return () => es.close();
  }, [live, level, q]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Logs</h1>
          <p className="text-sm text-muted">Aktivitas request &amp; error server. Live tail via SSE.</p>
        </div>
        <Button size="sm" variant="ghost" disabled={!nextOffset} onClick={() => load(false, level, q, nextOffset ?? 0)}>
          Muat lebih banyak
        </Button>
      </div>

      {err && <p className="text-sm text-red-400">gagal: {err}</p>}

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Statistik</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Badge variant="outline">{stats.total} total</Badge>
          <Badge variant={stats.error ? "destructive" : "outline"}>{stats.error} error</Badge>
          <Badge variant="secondary">{stats.warn} warn</Badge>
          <Badge variant="outline">{stats.info} info</Badge>
          <Badge variant="outline">{stats.last_hour} 1 jam terakhir</Badge>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Filter</CardTitle>
          </div>
          <Button size="sm" variant={live ? "secondary" : "outline"} onClick={() => setLive((v) => !v)}>
            {live ? "● live" : "○ jeda"}
          </Button>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          {["", ...LEVELS].map((l) => (
            <Button key={l} size="sm" variant={level === l ? "default" : "ghost"} onClick={() => setLevel(l)}>
              {l || "semua"}
            </Button>
          ))}
          <Input
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") setQ(qInput.trim());
            }}
            placeholder="path / pesan / tool"
            className="w-52"
          />
          <Button size="sm" onClick={() => setQ(qInput.trim())}>
            Cari
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setQInput("");
              setQ("");
              setLevel("");
            }}
          >
            Reset
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Aktivitas</CardTitle>
            <CardDescription>{live ? "live tail aktif" : "live tail dijeda"}</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {loading ? (
            <>
              <Skeleton className="h-14" />
              <Skeleton className="h-14" />
              <Skeleton className="h-14" />
            </>
          ) : rows.length ? (
            rows.map((r, i) => (
              <div key={r.id ?? i} className="rounded-md border border-line p-2">
                <div className="flex flex-wrap items-center gap-1 text-sm">
                  <Badge variant={r.level === "error" ? "destructive" : r.level === "warn" ? "secondary" : "outline"}>
                    {r.level}
                  </Badge>
                  <b>{r.event}</b>
                  {r.meta?.tool && <Badge variant="secondary">{r.meta.tool}</Badge>}
                  {r.meta?.query && <span className="text-xs text-muted">{r.meta.query}</span>}
                </div>
                <div className="mt-1 text-xs text-muted">
                  {(r.ts || "").slice(0, 19)} · {r.source} · {r.method || "—"} {r.path || "—"} ·
                  <span className={r.status != null && r.status >= 400 ? "text-red-400" : "text-accent"}>
                    {" "}{r.status ?? "—"}
                  </span>
                  {r.duration_ms != null ? ` · ${r.duration_ms}ms` : ""}
                </div>
                {r.message && (
                  <div className="mt-1 whitespace-pre-wrap text-xs text-muted">{r.message.slice(0, 200)}</div>
                )}
              </div>
            ))
          ) : (
            <p className="text-sm text-muted">tidak ada log.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
