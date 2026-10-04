import type { ReactNode } from "react";
import { Inbox } from "lucide-react";

export function Empty({
  title,
  desc,
  action,
  icon,
}: {
  title: string;
  desc?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-line px-6 py-10 text-center">
      <span className="text-faint">{icon ?? <Inbox size={28} aria-hidden />}</span>
      <div className="text-sm font-medium text-dim">{title}</div>
      {desc && <p className="max-w-sm text-xs text-faint">{desc}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
