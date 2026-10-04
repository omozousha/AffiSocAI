import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { Select } from "../../components/ui/input";
import { Empty } from "../../components/ui/empty";

export interface ContentRow {
  id: number;
  link_id: number;
  platform: string;
  status: string;
  body: string;
}

/** Daftar konten tersimpan + filter platform/status + load-more. */
export function SavedContentCard({
  rows,
  filtered,
  cap,
  fp,
  fs,
  onFp,
  onFs,
  onMore,
}: {
  rows: ContentRow[];
  filtered: ContentRow[];
  cap: number;
  fp: string;
  fs: string;
  onFp: (v: string) => void;
  onFs: (v: string) => void;
  onMore: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Konten tersimpan</CardTitle>
          <CardDescription>
            {filtered.length}/{rows.length} konten
          </CardDescription>
        </div>
        <div className="flex gap-2">
          <Select value={fp} onChange={(e) => onFp(e.target.value)} aria-label="filter platform">
            <option value="">Semua platform</option>
            <option value="instagram">instagram</option>
            <option value="facebook">facebook</option>
            <option value="threads">threads</option>
          </Select>
          <Select value={fs} onChange={(e) => onFs(e.target.value)} aria-label="filter status">
            <option value="">Semua status</option>
            <option value="draft">draft</option>
            <option value="published">published</option>
          </Select>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {!filtered.length ? (
          <Empty title="Belum ada konten" desc="Generate caption di atas, lalu simpan sebagai draft — posting terjadwal memakainya." />
        ) : (
          <>
            {filtered.slice(0, cap).map((c) => (
              <div key={c.id} className="rounded-md border border-line p-2">
                <div className="flex items-center gap-1 text-sm font-medium">
                  {c.platform}
                  <Badge variant={c.status === "draft" ? "secondary" : "default"}>{c.status}</Badge>
                  <Badge variant="outline">link {c.link_id}</Badge>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-xs text-muted">
                  {c.body.slice(0, 160)}
                  {c.body.length > 160 ? "…" : ""}
                </p>
              </div>
            ))}
            {filtered.length > cap && (
              <Button size="sm" variant="ghost" className="w-full" onClick={onMore}>
                Muat lebih banyak (sisa {filtered.length - cap})
              </Button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
