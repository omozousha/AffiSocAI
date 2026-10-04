import { useEffect, useRef, useState } from "react";
import { Button } from "./button";

interface Dlg {
  title: string;
  body: string;
  danger?: boolean;
  okLabel?: string;
  resolve: (v: boolean) => void;
}

let open: ((d: Dlg | null) => void) | null = null;

export function confirmDlg(opts: { title: string; body: string; danger?: boolean; okLabel?: string }): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    if (!open) resolve(false); // host not mounted — refuse, never silently allow
    else open({ ...opts, resolve });
  });
}

/** Mount once in AppShell. Replaces window.confirm (absent on Chrome Android). */
export function ConfirmHost() {
  const [dlg, setDlg] = useState<Dlg | null>(null);
  const ref = useRef(setDlg);
  ref.current = setDlg;
  useEffect(() => {
    open = (d) => ref.current(d);
    return () => {
      open = null;
    };
  }, []);
  useEffect(() => {
    if (!dlg) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        dlg.resolve(false);
        setDlg(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dlg]);
  if (!dlg) return null;
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4" onClick={() => { dlg.resolve(false); setDlg(null); }}>
      <div role="alertdialog" aria-label={dlg.title} className="w-full max-w-sm space-y-4 rounded-xl border border-line bg-panel p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div>
          <div className="text-sm font-semibold">{dlg.title}</div>
          <p className="mt-1 text-sm text-muted">{dlg.body}</p>
        </div>
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => { dlg.resolve(false); setDlg(null); }}>
            Batal
          </Button>
          <Button
            size="sm"
            className={dlg.danger ? "bg-red-600 text-white hover:bg-red-500" : undefined}
            onClick={() => { dlg.resolve(true); setDlg(null); }}
          >
            {dlg.okLabel ?? "Ya, lanjutkan"}
          </Button>
        </div>
      </div>
    </div>
  );
}
