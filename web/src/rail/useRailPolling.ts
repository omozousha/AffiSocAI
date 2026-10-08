import { useEffect, useRef, useState } from "react";
import { api } from "../lib/utils";

export interface ProviderRow {
  slug: string;
  displayName: string;
  status: string;
  blockedReason?: string | null;
  capabilities?: string[];
}

export type RailStatus = "idle" | "loading" | "ok" | "degraded" | "error";

export interface RailData {
  providers: ProviderRow[];
  health: {
    ok: boolean;
    enabled: boolean;
    ready_platforms: string[];
    next: { scheduled_for?: string; slot_date?: string; slot_index?: number } | string | null;
    today_published: number;
  } | null;
  status: RailStatus;
  error: string | null;
  refresh: () => void;
}

const POLL_MS = 60_000;

/** /api/schedule/health `next` bisa berupa string ISO atau objek slot penuh. */
export function nextAtOf(health: RailData["health"]): string | null {
  const n = health?.next;
  if (!n) return null;
  return typeof n === "string" ? n : (n.scheduled_for ?? null);
}

/** Providers + scheduler health — 60s poll, degraded badge on error, never throws. */
export function useRailPolling(): RailData {
  const [data, setData] = useState<{
    providers: ProviderRow[];
    health: RailData["health"];
    status: RailStatus;
    error: string | null;
  }>({ providers: [], health: null, status: "idle", error: null });
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = async () => {
    const [p, h] = await Promise.all([
      api<{ providers: ProviderRow[] }>("/api/providers"),
      api<{
        ok: boolean;
        enabled: boolean;
        ready_platforms: string[];
        next: { scheduled_for?: string } | string | null;
        today_published: number;
      }>("/api/schedule/health"),
    ]);
    if (!alive.current) return;
    if (p.status !== 200) {
      setData({ providers: [], health: null, status: "error", error: `providers HTTP ${p.status}` });
      return;
    }
    setData({
      providers: p.body.providers ?? [],
      health: h.status === 200 ? h.body : null,
      status: h.status === 200 ? "ok" : "degraded",
      error: h.status === 200 ? null : "scheduler health HTTP " + h.status,
    });
  };

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(t);
  }, []);

  return { ...data, refresh: () => void load() };
}
