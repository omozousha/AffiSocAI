import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { Skeleton } from "../../components/ui/skeleton";
import type { Slot } from "../../lib/format";
import { SlotRow } from "./SlotRow";

/** Kartu slot mendatang (besok / tanggal pilihan) — read-only. */
export function UpcomingCard({ label, slots, loading }: { label: string; slots: Slot[]; loading: boolean }) {
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>{label}</CardTitle>
          <CardDescription>
            {label === "Besok"
              ? "Slot besok — jam baru yang ditambah muncul di sini."
              : `Slot tanggal ${label} — pilih tanggal lain dari kalender di atas.`}
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {loading ? (
          <Skeleton className="h-14" />
        ) : slots.length ? (
          slots.map((s) => <SlotRow key={s.id} s={s} compact />)
        ) : (
          <p className="text-sm text-muted">belum ada slot {label.toLowerCase()}.</p>
        )}
      </CardContent>
    </Card>
  );
}
