import { useEffect, useRef, useState } from "react";

export interface LogEvent {
  id: number;
  level: string;
  message: string;
  ts: string;
}

/**
 * Live tail of /api/logs/stream (SSE). Auto-reconnect with bounded backoff —
 * a dropped rail must never crash the host page or storm the server.
 */
export function useLogStream(max = 50): { events: LogEvent[]; connected: boolean } {
  const [events, setEvents] = useState<LogEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    let attempt = 0;
    let es: EventSource | null = null;
    let timer: number | undefined;

    const open = () => {
      if (!alive.current) return;
      es = new EventSource("/api/logs/stream");
      es.onopen = () => {
        attempt = 0;
        setConnected(true);
      };
      es.onmessage = (ev: MessageEvent<string>) => {
        try {
          const row = JSON.parse(ev.data) as { id?: number; level?: string; message?: string; created_at?: string };
          if (row.id == null) return;
          setEvents((prev) =>
            [{ id: row.id!, level: row.level ?? "info", message: row.message ?? "", ts: row.created_at ?? "" }, ...prev].slice(
              0,
              max,
            ),
          );
        } catch {
          /* malformed frame: ignore */
        }
      };
      es.onerror = () => {
        setConnected(false);
        es?.close();
        if (!alive.current) return;
        attempt = Math.min(attempt + 1, 5);
        timer = window.setTimeout(open, attempt * 1000);
      };
    };
    open();

    return () => {
      alive.current = false;
      es?.close();
      if (timer) clearTimeout(timer);
    };
  }, [max]);

  return { events, connected };
}
