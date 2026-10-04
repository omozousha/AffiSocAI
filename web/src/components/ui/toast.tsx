import { createContext, useCallback, useContext, useMemo, useReducer } from "react";
import { toastReducer, type ToastItem } from "../../lib/toast-store";

interface ToastApi {
  toast: (msg: string, kind?: "ok" | "err") => void;
}
const Ctx = createContext<ToastApi>({ toast: () => {} });

let seq = 1;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, dispatch] = useReducer(toastReducer, [] as ToastItem[]);
  const toast = useCallback((msg: string, kind: "ok" | "err" = "ok") => {
    const id = seq++;
    dispatch({ type: "add", item: { id, msg, kind, ts: Date.now() } });
    setTimeout(() => dispatch({ type: "remove", id }), 4000);
  }, []);
  const api = useMemo(() => ({ toast }), [toast]);
  return (
    <Ctx.Provider value={api}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed bottom-4 left-1/2 z-[60] flex w-full max-w-sm -translate-x-1/2 flex-col gap-2 px-4">
        {items.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto rounded-lg border px-3 py-2 text-sm shadow-lg backdrop-blur ${
              t.kind === "err" ? "border-red-500/40 bg-red-950/80 text-red-200" : "border-line bg-elev/95 text-fg"
            }`}
          >
            {t.msg}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast(): ToastApi {
  return useContext(Ctx);
}
