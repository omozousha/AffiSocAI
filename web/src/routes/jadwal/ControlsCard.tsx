import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";

/** Kartu Kontrol: badge agregat tren + platform + daftar jam posting (hapus/tambah). */
export function ControlsCard({
  published7h,
  failed,
  queue,
  platforms,
  slotTimes,
  onDeleteTime,
  onAddTime,
}: {
  published7h: number;
  failed: number;
  queue: number;
  platforms: { slug: string; ready: boolean }[];
  slotTimes: string[];
  onDeleteTime: (i: number) => void;
  onAddTime: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Kontrol</CardTitle>
          <CardDescription>Berlaku untuk slot besok dan seterusnya.</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">{published7h} terbit (7h)</Badge>
          <Badge variant={failed ? "destructive" : "outline"}>{failed} gagal</Badge>
          <Badge variant="outline">{queue} konten siap</Badge>
          {platforms.map((p) => (
            <Badge key={p.slug} variant={p.ready ? "default" : "destructive"}>
              {p.slug} {p.ready ? "siap" : "tidak siap"}
            </Badge>
          ))}
        </div>
        <div>
          <div className="mb-2 text-sm font-medium">Jam posting (WIB)</div>
          <div className="flex flex-wrap items-center gap-2">
            {slotTimes.map((t, i) => (
              <Badge key={t} variant="secondary" className="gap-1 text-sm">
                {t}
                <button aria-label={`hapus jam ${t}`} className="ml-1 hover:text-red-400" onClick={() => onDeleteTime(i)}>
                  ×
                </button>
              </Badge>
            ))}
            {slotTimes.length < 6 && (
              <Button size="sm" variant="outline" onClick={onAddTime}>
                + tambah jam
              </Button>
            )}
          </div>
          <p className="mt-1 text-xs text-muted">Maksimal 6 jam. Jam baru berlaku mulai besok — lihat seksi Besok di bawah.</p>
        </div>
      </CardContent>
    </Card>
  );
}
