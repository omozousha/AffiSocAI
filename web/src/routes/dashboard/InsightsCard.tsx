import { Button } from "../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import type { InsightsBody } from "../Dashboard";

/**
 * P2.8 — advisory panel: rank of local (WIB) hours by 30-day avg reach.
 * Applying a suggestion is the operator's call (POST /api/schedule/config is
 * done by Jadwal); here we only hand the string over via `onApply`.
 */
export function InsightsCard({
  insights,
  current,
  onApply,
}: {
  insights: InsightsBody;
  current: string[];
  onApply: (times: string) => void;
}) {
  const best = insights.best_hours ?? [];
  const times = insights.suggested_times ?? [];
  if (best.length === 0) return null;
  const changed = times.join(",") !== current.join(",");
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Jam prime menurut data</CardTitle>
          <CardDescription>
            Rata-rata jangkauan per jam (WIB, 30 hari · min 3 post/jam). {best[0] && <>Jam {best[0].hourLocal}:00 memimpin — {best[0].avgReach.toFixed(0)} avg.</>}
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-2">
        {best.map((h, i) => (
          <span key={h.hourLocal} className={`rounded-md border px-2.5 py-1 text-sm ${i === 0 ? "border-accent bg-accent/10 text-fg" : "border-line bg-elev text-muted"}`}>
            <b className="num">{h.hourLocal}:30</b> · reach {h.avgReach.toFixed(0)} · {h.posts} post
          </span>
        ))}
        {changed && times.length > 0 && (
          <Button size="sm" variant="ghost" onClick={() => onApply(times.join(","))}>
            Pakai jam ini
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
