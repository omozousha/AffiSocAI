import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";

/** Kartu Riwayat: bar distribusi jam posting (UTC→WIB) + top link 7 hari. */
export function HistoryCard({
  range,
  byHour,
  top,
  topLinks,
}: {
  range: string;
  byHour: [string, number][];
  top: number;
  topLinks: { title: string; count: number }[];
}) {
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Riwayat</CardTitle>
          <CardDescription>{range} · dari slot yang benar-benar terbit</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {byHour.length ? (
          byHour.map(([h, n]) => (
            <div key={h} className="flex items-center gap-2 text-sm">
              <span className="num w-12 text-muted">{((Number(h) + 7) % 24) + ":00"}</span>
              <span className="h-2 rounded bg-accent" style={{ width: `${Math.round((n / top) * 100)}%`, minWidth: 8 }} />
              <b className="num">{n}</b>
            </div>
          ))
        ) : (
          <p className="text-sm text-muted">belum ada posting.</p>
        )}
        <ul className="mt-2 text-sm">
          {topLinks.slice(0, 3).map((l) => (
            <li key={l.title}>
              {l.title} <span className="text-muted">×{l.count}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
