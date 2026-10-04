import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { Skeleton } from "../../components/ui/skeleton";
import { PLAT_LABEL, STATUS_LABEL, STATUS_VARIANT, wibHm, type Slot } from "../../lib/format";

/** Kartu "Hari ini": daftar slot terjadwal + status badge + label link. */
export function TodayCard({
  date,
  published,
  slots,
  loading,
  linkLabel,
  onManage,
}: {
  date: string;
  published: number;
  slots: Slot[];
  loading: boolean;
  linkLabel: (s: Slot) => string;
  onManage: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Hari ini</CardTitle>
          <CardDescription>
            {date} · {published}/{slots.length} terbit
          </CardDescription>
        </div>
        <Button variant="ghost" size="sm" onClick={onManage}>
          Kelola jadwal
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {loading ? (
          <>
            <Skeleton className="h-14" />
            <Skeleton className="h-14" />
            <Skeleton className="h-14" />
          </>
        ) : slots.length ? (
          slots.map((s) => (
            <div key={s.id} className="flex items-center gap-3 rounded-md border border-line p-3">
              <div className="num w-14 flex-none text-lg font-bold">
                {wibHm(s.scheduled_for)}
                <span className="block text-[10px] font-normal text-muted">WIB</span>
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{linkLabel(s)}</div>
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  <Badge variant={STATUS_VARIANT[s.status] ?? "outline"}>{STATUS_LABEL[s.status] ?? s.status}</Badge>
                  {String(s.platform || "")
                    .split(",")
                    .map((x) => x.trim())
                    .filter(Boolean)
                    .map((n) => (
                      <Badge key={n} variant="secondary">
                        {PLAT_LABEL[n] || n}
                      </Badge>
                    ))}
                </div>
              </div>
            </div>
          ))
        ) : (
          <p className="text-sm text-muted">Belum ada slot hari ini.</p>
        )}
      </CardContent>
    </Card>
  );
}
