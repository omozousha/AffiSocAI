// Wizard pipeline state machine — pure, unit-testable, no DOM.
// Satu lintasan operator: link → image → caption → publish.

export type WizardStep = "link" | "image" | "caption" | "publish" | "done";
export const WIZARD_STEPS: readonly WizardStep[] = ["link", "image", "caption", "publish"] as const;

export type StepStatus = "idle" | "running" | "ok" | "failed";

export interface WizardState {
  linkId: number | null;
  shortUrl: string;
  product: string;
  imageUrl: string;
  caption: string;
  platforms: string[];
  step: WizardStep;
  status: Record<WizardStep, StepStatus>;
  error: string | null;
  regenCount: number;
}

export const MAX_REGEN = 2;

export function initialState(): WizardState {
  return {
    linkId: null,
    shortUrl: "",
    product: "",
    imageUrl: "",
    caption: "",
    platforms: ["instagram", "facebook"],
    step: "link",
    status: { link: "idle", image: "idle", caption: "idle", publish: "idle", done: "idle" },
    error: null,
    regenCount: 0,
  };
}

export type WizardAction =
  | { type: "link_created"; linkId: number; product: string; imageUrl: string; shortUrl: string }
  | { type: "start"; step: WizardStep }
  | { type: "step_ok"; step: WizardStep; patch?: Partial<WizardState> }
  | { type: "step_fail"; step: WizardStep; error: string }
  | { type: "regen" }
  | { type: "set_caption"; caption: string }
  | { type: "toggle_platform"; platform: string }
  | { type: "finish" };

/** Next step after `s` in the linear chain; `publish` → `done`. */
export function nextStep(s: WizardStep): WizardStep {
  const i = WIZARD_STEPS.indexOf(s);
  return i < 0 || i === WIZARD_STEPS.length - 1 ? "done" : WIZARD_STEPS[i + 1];
}

/** A step may run only when its predecessor is ok (or it is the first). */
export function canRun(state: WizardState, step: WizardStep): boolean {
  const i = WIZARD_STEPS.indexOf(step);
  if (i <= 0) return true;
  return state.status[WIZARD_STEPS[i - 1]] === "ok";
}

export function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case "link_created":
      return {
        ...state,
        linkId: action.linkId,
        product: action.product,
        imageUrl: action.imageUrl,
        shortUrl: action.shortUrl,
        status: { ...state.status, link: "ok" },
        step: "image",
        error: null,
      };
    case "start":
      if (!canRun(state, action.step)) return state;
      return { ...state, step: action.step, status: { ...state.status, [action.step]: "running" }, error: null };
    case "step_ok": {
      const status = { ...state.status, [action.step]: "ok" as StepStatus };
      const nxt = nextStep(action.step);
      return { ...state, ...action.patch, status, step: action.step === "publish" ? "done" : nxt };
    }
    case "step_fail":
      return {
        ...state,
        status: { ...state.status, [action.step]: "failed" },
        error: action.error,
      };
    case "regen":
      // Auto-retry terbatas (parity dengan scheduler: maks MAX_REGEN).
      if (state.regenCount >= MAX_REGEN) return state;
      return { ...state, regenCount: state.regenCount + 1, status: { ...state.status, image: "running" } };
    case "set_caption":
      return { ...state, caption: action.caption };
    case "toggle_platform": {
      const has = state.platforms.includes(action.platform);
      const platforms = has
        ? state.platforms.filter((p) => p !== action.platform)
        : [...state.platforms, action.platform];
      return { ...state, platforms };
    }
    case "finish":
      return { ...state, step: "done", status: { ...state.status, done: "ok" } };
    default:
      return state;
  }
}

/** sessionStorage persistence — reload tidak membuang progres. */
const KEY = "affisocai.wizard";
export function saveWizard(s: WizardState): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage penuh / private-mode: abaikan, alur tetap jalan */
  }
}
export function loadWizard(): WizardState | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as WizardState;
    return s && typeof s === "object" && "step" in s ? s : null;
  } catch {
    return null;
  }
}
export function clearWizard(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* noop */
  }
}
