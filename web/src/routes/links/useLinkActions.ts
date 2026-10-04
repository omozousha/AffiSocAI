import { api } from "../../lib/utils";

type ToastFn = (msg: string, kind?: "ok" | "err") => void;

/**
 * Aksi per-baris link (posting/hapus/enrich/recreate/bio). Dipindah dari
 * container supaya Links.tsx tetap orkestrasi. Flow recreate = async job:
 * POST -> 202 jobId -> poll tiap 5s maks 60x.
 */
export function makeLinkActions(deps: {
  toast: ToastFn;
  confirm: (opts: { title: string; body: string; danger?: boolean; okLabel?: string }) => Promise<boolean>;
  setRowBusy: (v: string | null) => void;
  load: () => Promise<void> | void;
}) {
  const { toast, confirm, setRowBusy, load } = deps;

  return async function rowAction(act: string, id: number) {
    const key = `${id}-${act}`;
    setRowBusy(key);
    try {
      if (act === "posting") {
        const r = await api<{ error?: string; platform?: string; content_id?: number }>(`/api/links/${id}/post`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        });
        const ok = r.status === 200;
        toast(ok ? `terbit: ${r.body.platform} #${r.body.content_id}` : r.body.error || "posting gagal", ok ? "ok" : "err");
      } else if (act === "hapus") {
        const okc = await confirm({ title: `Hapus link #${id}?`, body: "Konten terkait ikut terhapus. Tidak bisa dibatalkan.", danger: true, okLabel: "Hapus" });
        if (!okc) return;
        const r = await api<{ error?: string }>(`/api/links/${id}`, { method: "DELETE" });
        const ok = r.status === 200;
        toast(ok ? `link #${id} dihapus` : r.body.error || "gagal menghapus", ok ? "ok" : "err");
      } else if (act === "enrich") {
        const r = await api<{ error?: string }>(`/api/links/${id}/enrich`, { method: "POST" });
        const ok = r.status === 200;
        toast(ok ? `#${id} enriched` : r.body.error || "enrich gagal", ok ? "ok" : "err");
      } else if (act === "recreate") {
        const r = await api<{ error?: string; jobId?: string; status?: string }>(`/api/links/${id}/recreate-image`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        });
        if (r.status === 202 && r.body.jobId) {
          // Flow async — poll until done
          const jobId = r.body.jobId;
          toast("Flow generate dimulai — menunggu hasil…");
          const poll = async () => {
            for (let i = 0; i < 60; i++) {
              await new Promise((res) => setTimeout(res, 5000));
              try {
                const p = await api<{ status: string; result?: { ok?: boolean; live?: boolean; backend?: string; error?: string } }>(
                  `/api/links/${id}/recreate-image/status?jobId=${jobId}`,
                );
                if (p.body.status === "running") {
                  toast(`Flow sedang generate… ${(i + 1) * 5}s`);
                  continue;
                }
                if (p.body.status === "done") {
                  const res = p.body.result;
                  toast(
                    res?.ok && res?.live
                      ? `Flow berhasil (${res.backend}) — gambar #${id} diperbarui`
                      : res?.ok && !res?.live
                        ? "Flow generate tapi gate reject — foto asli dipakai"
                        : `Flow gagal: ${res?.error || "unknown"}`,
                    res?.ok ? "ok" : "err",
                  );
                  load();
                  return;
                }
                if (p.body.status === "error") {
                  toast(`Flow error: ${p.body.result?.error || "unknown"}`, "err");
                  return;
                }
              } catch {
                /* ignore poll error, retry */
              }
            }
            toast("Flow timeout — cek lagi nanti", "err");
          };
          poll().finally(() => {
            setRowBusy(null);
            load();
          });
          return; // skip the finally below — poll handles cleanup
        } else {
          const ok = r.status === 200;
          toast(ok ? `gambar #${id} dibuat ulang` : r.body.error || "recreate gagal", ok ? "ok" : "err");
        }
      } else if (act === "bio") {
        const r = await api<{ error?: string }>("/api/bio/publish", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ link_id: id }),
        });
        const ok = r.status >= 200 && r.status < 300;
        toast(ok ? `bio #${id} terbit` : r.body.error || "bio gagal", ok ? "ok" : "err");
      }
      load();
    } catch (e) {
      toast(String(e), "err");
    } finally {
      setRowBusy(null);
    }
  };
}
