export const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

/** "YYYY-MM-DD HH:MM:SS" UTC → "HH:MM" WIB. */
export function wibHm(stamp?: string | null): string {
  if (!stamp) return "—";
  const [datePart, timePart = "00:00:00"] = stamp.trim().split(" ");
  const [y, mo, d] = datePart.split("-").map(Number);
  const [h, mi] = timePart.split(":").map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d, h, mi) + WIB_OFFSET_MS);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(dt.getUTCHours())}:${p(dt.getUTCMinutes())}`;
}

export const PLAT_LABEL: Record<string, string> = {
  instagram: "IG",
  facebook: "FB",
  threads: "TH",
};

export type SlotStatus = "published" | "pending" | "claimed" | "failed" | "skipped";

export const STATUS_LABEL: Record<SlotStatus, string> = {
  published: "terbit",
  pending: "menunggu",
  claimed: "diproses",
  failed: "gagal",
  skipped: "dilewati",
};

export type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

export const STATUS_VARIANT: Record<SlotStatus, BadgeVariant> = {
  published: "default",
  pending: "secondary",
  claimed: "secondary",
  failed: "destructive",
  skipped: "outline",
};

export interface Slot {
  id: number;
  slot_index: number;
  scheduled_for: string;
  status: SlotStatus;
  platform: string;
  link_id: number | null;
}

export interface Link {
  link_health?: string | null;
  id: number;
  product?: string;
  short_url?: string;
}
