import { useEffect, useReducer } from "react";
import { CheckCircle, Circle, Sparkles, Wand2 } from "lucide-react";
import { Card } from "../../components/ui/card";
import { StepLink } from "./StepLink";
import { StepImage } from "./StepImage";
import { StepCaption } from "./StepCaption";
import { StepPublish } from "./StepPublish";
import {
  clearWizard,
  initialState,
  loadWizard,
  saveWizard,
  WIZARD_STEPS,
  wizardReducer,
  type WizardStep,
} from "./wizard-machine";

export default function PipelineWizard() {
  const [state, dispatch] = useReducer(wizardReducer, null, () => loadWizard() || initialState());

  useEffect(() => {
    saveWizard(state);
  }, [state]);

  const stepLabels: Record<WizardStep, string> = {
    link: "1. Rekat Link",
    image: "2. Generate Gambar",
    caption: "3. Smart Caption",
    publish: "4. Penerbitan",
    done: "Selesai",
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Wand2 className="text-accent" size={22} />
            Pipeline Wizard 1-Layar
          </h1>
          <p className="text-xs text-muted mt-1">
            Alur kerja lengkap operator: dari tautan mentah Shopee sampai tayang ke sosmed dalam satu flow terpadu.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Side: Vertical Stepper */}
        <div className="lg:col-span-4 flex flex-col gap-3">
          <Card className="p-4 border-line bg-panel/40">
            <span className="text-[11px] font-bold text-muted uppercase tracking-wider mb-3 block">
              Tahapan Alur
            </span>
            <div className="flex flex-col gap-2.5">
              {WIZARD_STEPS.map((s) => {
                const isCurrent = state.step === s;
                const isPassed = state.status[s] === "ok";
                return (
                  <div
                    key={s}
                    className={`flex items-center gap-2.5 text-xs p-2 rounded-md transition-colors ${
                      isCurrent
                        ? "bg-accent/15 border-l-2 border-accent text-accent font-semibold"
                        : isPassed
                          ? "text-fg/80"
                          : "text-muted"
                    }`}
                  >
                    {isPassed ? (
                      <CheckCircle size={15} className="text-emerald-400 shrink-0" />
                    ) : (
                      <Circle size={15} className={isCurrent ? "text-accent shrink-0" : "text-faint shrink-0"} />
                    )}
                    <span>{stepLabels[s]}</span>
                  </div>
                );
              })}
            </div>
          </Card>

          {/* Current Working Summary Card */}
          {state.linkId && (
            <Card className="p-4 border-line bg-panel/30 text-xs flex flex-col gap-2">
              <span className="text-[10px] font-bold text-muted uppercase tracking-wider">Ringkasan Sesi</span>
              <div className="truncate font-medium text-fg">{state.product || "Memuat produk…"}</div>
              <div className="truncate text-[11px] text-muted">{state.shortUrl}</div>
              {state.imageUrl && (
                <div className="mt-1">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={state.imageUrl}
                    alt="Preview"
                    className="w-full h-24 object-cover rounded border border-line"
                  />
                </div>
              )}
            </Card>
          )}
        </div>

        {/* Right Side: Active Step Execution Container */}
        <div className="lg:col-span-8 flex flex-col gap-4">
          {state.error && (
            <div className="rounded-md border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-400">
              {state.error}
            </div>
          )}

          {state.step === "link" && (
            <StepLink
              onSuccess={(data) => dispatch({ type: "link_created", ...data })}
              onError={(err) => dispatch({ type: "step_fail", step: "link", error: err })}
            />
          )}

          {state.step === "image" && state.linkId && (
            <StepImage
              linkId={state.linkId}
              product={state.product}
              imageUrl={state.imageUrl}
              regenCount={state.regenCount}
              onDone={(img) => dispatch({ type: "step_ok", step: "image", patch: { imageUrl: img } })}
              onSkip={() => dispatch({ type: "step_ok", step: "image" })}
              onError={(err) => dispatch({ type: "step_fail", step: "image", error: err })}
              onRegen={() => dispatch({ type: "regen" })}
            />
          )}

          {state.step === "caption" && state.linkId && (
            <StepCaption
              linkId={state.linkId}
              product={state.product}
              platforms={state.platforms}
              onDone={(cap) => dispatch({ type: "step_ok", step: "caption", patch: { caption: cap } })}
              onError={(err) => dispatch({ type: "step_fail", step: "caption", error: err })}
            />
          )}

          {state.step === "publish" && state.linkId && (
            <StepPublish
              linkId={state.linkId}
              caption={state.caption}
              product={state.product}
              shortUrl={state.shortUrl}
              platforms={state.platforms}
              onFinish={() => {
                clearWizard();
                dispatch({ type: "finish" });
              }}
              onBack={() => dispatch({ type: "start", step: "caption" })}
            />
          )}

          {state.step === "done" && (
            <Card className="p-6 border-line bg-panel/50 text-center flex flex-col items-center gap-3">
              <Sparkles size={32} className="text-accent animate-bounce" />
              <h3 className="text-sm font-bold">Pipeline Berhasil Diselesaikan!</h3>
              <p className="text-xs text-muted max-w-sm">
                Produk sudah masuk antrean / terbit di kanal sosial media. Ingin memproses produk lain?
              </p>
              <button
                type="button"
                className="mt-2 text-xs font-semibold px-4 py-2 bg-accent text-bg rounded-md hover:bg-accent/90"
                onClick={() => {
                  clearWizard();
                  window.location.reload();
                }}
              >
                Mulai Produk Baru
              </button>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
