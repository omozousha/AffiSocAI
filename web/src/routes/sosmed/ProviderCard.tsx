import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { useToast } from "../../components/ui/toast";
import { api } from "../../lib/utils";

export interface Provider {
  slug: string;
  displayName: string;
  status: string;
  blockedReason?: string | null;
  capabilities: Record<string, boolean>;
}

export const OPS = ["textPost", "imagePost", "videoPost", "carouselPost", "scheduledPost", "analytics"];

/** Satu kartu provider: status badge, matriks kapabilitas, aksi koneksi/publish/validate. */
export function ProviderCard({
  p,
  busy,
  composer,
  onRun,
  onOpenAuth,
}: {
  p: Provider;
  busy: boolean;
  composer: () => { text: string; mediaUrl: string | undefined; mediaKind: string };
  onRun: (key: string, fn: () => Promise<{ status: number; body: unknown }>, okMsg: string) => void;
  onOpenAuth: (url: string) => void;
}) {
  const { toast } = useToast();
  const live = p.status === "VERIFIED-EXECUTED";
  return (
    <div className="rounded-md border border-line p-3">
      <div className="flex items-center justify-between">
        <b className="text-sm">{p.displayName}</b>
        <Badge variant={live ? "default" : p.status === "VERIFIED-VIA-SCHEMA" ? "secondary" : "outline"}>
          {live ? "LIVE" : p.status === "VERIFIED-VIA-SCHEMA" ? "SCHEMA" : "DISABLED"}
        </Badge>
      </div>
      <p className="mt-1 text-xs text-muted">
        {OPS.map((k) => `${k}=${p.capabilities[k] ? "✓" : "✗"}`).join(" ")}
      </p>
      {p.blockedReason && <p className="mt-1 text-xs text-red-400">{p.blockedReason}</p>}
      <div className="mt-2 flex flex-wrap gap-1">
        {p.slug === "threads" && (
          <>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={async () => {
                const r = await api<{ url?: string; error?: string }>("/api/providers/threads/authorize");
                if (r.status === 200 && r.body.url) {
                  onOpenAuth(r.body.url);
                  toast("tab otorisasi Threads dibuka");
                } else {
                  toast(r.body.error || "gagal minta URL otorisasi", "err");
                }
              }}
            >
              Hubungkan
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => onRun("threads-session", () => api("/api/providers/threads/session"), "Threads terhubung")}>
              Cek koneksi
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={busy}
              onClick={() =>
                onRun(
                  "threads-reset",
                  () => api("/api/providers/threads/reset", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }),
                  "Threads diputus",
                )
              }
            >
              Putuskan
            </Button>
          </>
        )}
        <Button size="sm" variant="ghost" disabled={busy || !live} onClick={() => onRun(`account-${p.slug}`, () => api(`/api/providers/${p.slug}/account`), `akun ${p.slug} terbaca`)}>
          Account
        </Button>
        {live && (
          <Button
            size="sm"
            disabled={busy}
            onClick={() =>
              onRun(
                `publish-${p.slug}`,
                () => api(`/api/providers/${p.slug}/publish`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(composer()) }),
                `publish test ke ${p.slug} terkirim`,
              )
            }
          >
            Publish test
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() =>
            onRun(
              `validate-${p.slug}`,
              () => api(`/api/providers/${p.slug}/validate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(composer()) }),
              `payload ${p.slug} valid`,
            )
          }
        >
          Validate
        </Button>
      </div>
    </div>
  );
}
