import { cn } from "../../lib/utils";

/**
 * Animated progress bar with a live label of what the backend is doing.
 *
 * `percent` is driven by real pipeline progress (link N of M), never by a
 * fake timer — the bar only advances when the server says it did.
 */
export function ProgressBar({
  percent,
  label,
  sub,
  className,
  tone = "accent",
}: {
  percent: number;
  label?: string;
  sub?: string;
  className?: string;
  tone?: "accent" | "ok" | "err";
}) {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  const barColor =
    tone === "ok" ? "var(--color-accent)" : tone === "err" ? "#e06c75" : "var(--color-accent)";
  return (
    <div className={cn("flex flex-col gap-1.5", className)} role="status" aria-live="polite">
      {(label || sub) && (
        <div className="flex items-baseline justify-between gap-2">
          {label && <span className="text-xs text-dim truncate">{label}</span>}
          <span className="num text-xs text-muted shrink-0">{clamped}%</span>
        </div>
      )}
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-elev">
        <div
          className="h-full rounded-full transition-[width] duration-500 ease-out"
          style={{
            width: `${clamped}%`,
            background: barColor,
            // subtle sheen so the bar reads as live, not stuck
            backgroundImage:
              "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.18) 50%, transparent 100%)",
            backgroundSize: "200% 100%",
            animation: clamped > 0 && clamped < 100 ? "prog-sheen 1.2s linear infinite" : undefined,
          }}
        />
      </div>
      {sub && <span className="num text-[11px] text-faint truncate">{sub}</span>}
      <style>{`
        @keyframes prog-sheen {
          0% { background-position: 100% 0; }
          100% { background-position: -100% 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          [style*="prog-sheen"] { animation: none !important; }
        }
      `}</style>
    </div>
  );
}
