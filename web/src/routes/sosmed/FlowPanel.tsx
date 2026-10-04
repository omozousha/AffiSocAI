import { useRef, useState } from "react";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { useToast } from "../../components/ui/toast";
import { confirmDlg } from "../../components/ui/confirm";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { api } from "../../lib/utils";

export interface FlowStatus {
  live: boolean;
  count: number;
  earliestExpiry: string | null;
  daysLeft: number | null;
}

/** Kartu sesi Google Flow: import cookie JSON, status hidup/expired, hapus sesi. */
export function FlowPanel({ flowSt, refreshFlow }: { flowSt: FlowStatus | null; refreshFlow: () => Promise<void> }) {
  const { toast } = useToast();
  const [flowBusy, setFlowBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Google Flow</CardTitle>
          <CardDescription>Import cookies JSON dari Chrome — Nano Banana 2 gratis ~180 hari.</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Badge variant={flowSt?.live ? "default" : "outline"}>
            {flowSt?.live ? "AKTIF" : flowSt === null ? "…" : "TIDAK AKTIF"}
          </Badge>
          {flowSt?.live && (
            <span className="text-xs text-muted">
              {flowSt.count} cookies · expire {flowSt.earliestExpiry} ({flowSt.daysLeft} hari lagi)
            </span>
          )}
          {flowSt && !flowSt.live && flowSt.count > 0 && (
            <span className="text-xs text-red-400">Cookies expired — reimport.</span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setFlowBusy(true);
              try {
                const text = await file.text();
                const body = JSON.parse(text);
                const r = await api<{ ok: boolean; count?: number; earliestExpiry?: string; error?: string }>(
                  "/api/flow/cookies",
                  { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
                );
                if (r.status === 200) {
                  toast(`Flow: ${r.body.count} cookies disimpan · expire ${r.body.earliestExpiry}`);
                  await refreshFlow();
                } else {
                  toast(r.body.error || "gagal import cookies", "err");
                }
              } catch (err) {
                toast(`Error: ${String(err)}`, "err");
              } finally {
                setFlowBusy(false);
                if (fileRef.current) fileRef.current.value = "";
              }
            }}
          />
          <Button size="sm" disabled={flowBusy} onClick={() => fileRef.current?.click()}>
            {flowBusy ? "Mengimpor…" : "Import cookies JSON"}
          </Button>
          <Button size="sm" variant="ghost" disabled={flowBusy} onClick={refreshFlow}>
            Refresh status
          </Button>
          {flowSt?.live && (
            <Button
              size="sm"
              variant="destructive"
              disabled={flowBusy}
              onClick={async () => {
                setFlowBusy(true);
                try {
                  const okc = await confirmDlg({ title: "Hapus sesi Flow?", body: "Harus import cookie Chrome lagi untuk generate via Flow.", danger: true, okLabel: "Hapus" });
                  if (!okc) return;
                  await api("/api/flow/cookies", { method: "DELETE" });
                  toast("Flow session dihapus");
                  await refreshFlow();
                } finally {
                  setFlowBusy(false);
                }
              }}
            >
              Hapus sesi
            </Button>
          )}
        </div>

        <p className="text-xs text-muted">
          Export dari Chrome: buka flow.google.com saat login → ekstensi cookie export (mis. EditThisCookie) → Export
          JSON → upload di sini.
        </p>
      </CardContent>
    </Card>
  );
}
