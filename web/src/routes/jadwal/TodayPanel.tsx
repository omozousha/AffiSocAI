import { Button } from "../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { Skeleton } from "../../components/ui/skeleton";
import type { Slot } from "../../lib/format";
import { SlotRow } from "./SlotRow";

/** Kartu "Hari ini": progres terbit + jeda + baris slot interaktif. */
export function TodayPanel({
  date,
  published,
  slots,
  nextId,
  busyId,
  loading,
  enabled,
  onTogglePause,
  onRun,
}: {
  date: string;
  published: number;
  slots: Slot[];
  nextId: number | null;
  busyId: number | null;
  loading: boolean;
  enabled: boolean;
  onTogglePause: () => void;
  onRun: (id: number) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Hari ini</CardTitle>
          <CardDescription>
            {date} · {published}/{slots.length} terbit · tiap slot ke semua platform aktif
          </CardDescription>
        </div>
        <Button variant="ghost" size="sm" onClick={onTogglePause}>
          {enabled ? "Jeda" : "Lanjutkan"}
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
            <SlotRow key={s.id} s={s} isNext={s.id === nextId} busyId={busyId} onRun={onRun} />
          ))
        ) : (
          <p className="text-sm text-muted">belum ada slot hari ini.</p>
        )}
      </CardContent>
    </Card>
  );
}
