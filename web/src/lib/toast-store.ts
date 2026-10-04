// Toast state as a pure reducer so it is testable without a DOM.
export interface ToastItem {
  id: number;
  msg: string;
  kind: "ok" | "err";
  ts: number;
}
export type ToastAction = { type: "add"; item: ToastItem } | { type: "remove"; id: number };

export const TOAST_CAP = 4;

export function toastReducer(state: ToastItem[], action: ToastAction): ToastItem[] {
  switch (action.type) {
    case "add":
      return [...state, action.item].slice(-TOAST_CAP);
    case "remove":
      return state.filter((t) => t.id !== action.id);
  }
}
