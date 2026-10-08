import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Sparkles } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { api } from "../../lib/utils";

export interface StepCaptionProps {
  linkId: number;
  product: string;
  platforms: string[];
  onDone: (caption: string) => void;
  onError: (err: string) => void;
}

type Draft = { platform: string; body: string; headline?: string; status?: string };

/** Step 3 — smart caption AI + inline edit. First-pick per-platform draft; operator edits before publish. */
export function StepCaption({ linkId, product, platforms, onDone, onError }: StepCaptionProps) {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState<string>(platforms[0] ?? "instagram");

  // default textarea ke draft pertama sesuai platform aktif
  const initial = useMemo(
    () => drafts.find((d) => d.platform === active)?.body ?? "",
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [drafts.length, active],
  );
  const [text, setText] = useState<string>(initial);

  useEffect(() => {
    setText(initial);
  }, [initial]);

  const generate = async () => {
    setBusy(true);
    try {
      const r = await api<{ drafts?: Draft[]; error?: string }>("/api/content/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ link_id: linkId, platforms }),
      });
      if (r.status !== 200) throw new Error(r.body.error || "generate gagal");
      setDrafts(r.body.drafts ?? []);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // generate sekali di mount
  useEffect(() => {
    void generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkId]);

  return (
    <Card className="p-5 border-line bg-panel/50 flex flex-col gap-4">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Sparkles size={16} className="text-accent" />
        <span>Langkah 3: Smart Caption</span>
      </div>

      {busy && !drafts.length && (
        <div className="text-xs text-muted">AI sedang menyusun caption untuk “{product}”…</div>
      )}

      {drafts.length > 0 && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            {drafts.map((d) => (
              <Button
                key={d.platform}
                size="sm"
                variant={active === d.platform ? "default" : "ghost"}
                className="text-xs capitalize"
                onClick={() => setActive(d.platform)}
              >
                {d.platform}
              </Button>
            ))}
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="caption-edit" className="text-xs font-medium text-fg">
              Caption — {active} (edit langsung, batas 460 karakter)
            </label>
            <textarea
              id="caption-edit"
              rows={6}
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, 460))}
              disabled={busy}
              className="w-full rounded-md border border-line bg-bg px-3 py-2 text-xs text-fg focus:border-accent focus:outline-none resize-y"
              placeholder="AI caption will appear here…"
            />
            <span className="text-[11px] text-muted self-end">{text.length}/460</span>
          </div>

          <div className="flex justify-end">
            <Button
              size="sm"
              variant="default"
              className="gap-1.5 bg-accent text-bg hover:bg-accent/90 text-xs"
              onClick={() => onDone(text)}
              disabled={!text.trim()}
            >
              <span>Terima Caption</span>
              <ArrowRight size={13} />
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
