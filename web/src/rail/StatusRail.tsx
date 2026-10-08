import { useState } from "react";
import { Activity, ChevronDown, ChevronUp, Radio, RefreshCw, Sparkles, Wand2 } from "lucide-react";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { useRailPolling, nextAtOf, type ProviderRow } from "./useRailPolling";
import { useLogStream } from "./useLogStream";

function providerBadge(p: ProviderRow) {
  const isOk = p.status === "VERIFIED-EXECUTED" || p.status === "connected" || p.status === "active" || p.status === "ready";
  const label = p.status.slice(0, 12);
  return (
    <div key={p.slug} className="flex items-center justify-between text-xs py-1">
      <span className="truncate">{p.displayName || p.slug}</span>
      <Badge variant={isOk ? "default" : "destructive"} className="text-[10px] py-0 px-1.5 capitalize" title={p.status}>
        {label}
      </Badge>
    </div>
  );
}

export function StatusRail({ go }: { go: (routeId: string) => void }) {
  const [collapsed, setCollapsed] = useState(false);
  const rail = useRailPolling();
  const logs = useLogStream(10);

  const health = rail.health;
  const isHealthy = health?.ok ?? false;

  return (
    <aside
      className="hidden xl:flex w-72 flex-col gap-3 border-l border-line bg-panel/60 p-3 text-fg text-xs sticky top-0 h-screen overflow-y-auto"
      aria-label="Status Rail Operator"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-line pb-2">
        <div className="flex items-center gap-2">
          <Activity size={14} className={isHealthy ? "text-emerald-400" : "text-amber-400"} />
          <span className="font-semibold tracking-wide uppercase text-[11px]">Command Rail</span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            className="h-6 w-6 p-0"
            title="Refresh status"
            onClick={() => rail.refresh()}
          >
            <RefreshCw size={12} className={rail.status === "loading" ? "animate-spin" : ""} />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 w-6 p-0"
            title={collapsed ? "Expand rail" : "Collapse rail"}
            onClick={() => setCollapsed(!collapsed)}
          >
            {collapsed ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
          </Button>
        </div>
      </div>

      {!collapsed && (
        <>
          {/* Quick Actions */}
          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] font-semibold text-muted uppercase tracking-wider">Aksi Cepat</span>
            <Button
              size="sm"
              variant="default"
              className="justify-start gap-2 bg-accent/20 text-accent border border-accent/40 hover:bg-accent/30 text-xs h-7"
              onClick={() => go("wizard")}
            >
              <Wand2 size={13} />
              <span>Buka Pipeline Wizard</span>
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="justify-start gap-2 text-xs h-7"
              onClick={() => go("jadwal")}
            >
              <Sparkles size={13} />
              <span>Lihat Antrean Posting</span>
            </Button>
          </div>

          {/* Scheduler Health */}
          <div className="flex flex-col gap-1 rounded border border-line bg-bg/50 p-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold text-muted uppercase tracking-wider">Scheduler</span>
              <span
                className={`inline-block h-2 w-2 rounded-full ${
                  isHealthy ? "bg-emerald-400" : "bg-amber-400 animate-pulse"
                }`}
              />
            </div>
            <div className="text-[11px]">
              <div>Status: {health?.enabled ? "Aktif" : "Non-aktif"}</div>
              <div>Terbit hari ini: <span className="font-semibold">{health?.today_published ?? 0}</span> slot</div>
              <div className="text-muted truncate">
                Next: {nextAtOf(health) ? new Date(nextAtOf(health)!).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }) : "-"}
              </div>
            </div>
          </div>

          {/* Social Providers */}
          <div className="flex flex-col gap-1 rounded border border-line bg-bg/50 p-2">
            <div className="flex items-center justify-between pb-1 border-b border-line/60">
              <span className="text-[10px] font-semibold text-muted uppercase tracking-wider">Provider Sosmed</span>
              <button
                type="button"
                className="text-[10px] text-accent hover:underline"
                onClick={() => go("sosmed")}
              >
                Atur
              </button>
            </div>
            <div className="flex flex-col divide-y divide-line/40">
              {rail.providers.length === 0 ? (
                <span className="text-muted italic py-1">Tidak ada data</span>
              ) : (
                rail.providers.map(providerBadge)
              )}
            </div>
          </div>

          {/* Live Log Stream */}
          <div className="flex flex-col gap-1 flex-1 min-h-[140px] rounded border border-line bg-bg/50 p-2">
            <div className="flex items-center justify-between pb-1 border-b border-line/60">
              <div className="flex items-center gap-1.5">
                <Radio size={11} className={logs.connected ? "text-emerald-400 animate-pulse" : "text-faint"} />
                <span className="text-[10px] font-semibold text-muted uppercase tracking-wider">Live Stream</span>
              </div>
              <button
                type="button"
                className="text-[10px] text-accent hover:underline"
                onClick={() => go("logs")}
              >
                Semua
              </button>
            </div>
            <div className="flex flex-col gap-1 overflow-y-auto max-h-48 text-[11px] font-mono leading-tight">
              {logs.events.length === 0 ? (
                <span className="text-muted italic">Menunggu event…</span>
              ) : (
                logs.events.map((e) => (
                  <div key={e.id} className="truncate text-faint">
                    <span className={e.level === "error" ? "text-rose-400 font-bold" : "text-muted"}>
                      [{e.level.slice(0, 3).toUpperCase()}]
                    </span>{" "}
                    {e.message}
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </aside>
  );
}
