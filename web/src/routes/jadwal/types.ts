// Tipe payload API jadwal — dipakai Jadwal.tsx (dipindah keluar supaya container tetap ramping).
export interface StatusBody {
  enabled: boolean;
  today: { date: string; published: number; slots: import("../../lib/format").Slot[] };
  next?: { id: number; slot_date: string; scheduled_for: string } | null;
  platforms: { slug: string; ready: boolean }[];
  slot_times: string[];
}

export interface TrendBody {
  published: number;
  failed: number;
  content_queue: number;
  by_hour: Record<string, number>;
  top_links: { title: string; count: number }[];
}

export interface SchedBody {
  status: StatusBody;
  slots?: import("../../lib/format").Slot[];
  trend: TrendBody;
}

export interface HealthBody {
  ok: boolean;
}
