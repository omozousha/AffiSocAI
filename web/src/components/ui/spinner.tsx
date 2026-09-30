import { Loader2 } from "lucide-react";
import { cn } from "../../lib/utils";

export function Spinner({ className, label }: { className?: string; label?: string }) {
  return (
    <span role="status" aria-live="polite" className={cn("inline-flex items-center gap-1.5", className)}>
      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
      {label && <span className="text-xs">{label}</span>}
    </span>
  );
}
