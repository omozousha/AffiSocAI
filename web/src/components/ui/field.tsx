import type { ReactNode } from "react";

/** Label + control + hint/error, one unit. Keeps forms consistent app-wide. */
export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <label htmlFor={htmlFor} className="block space-y-1">
      <span className="text-xs font-medium text-dim">{label}</span>
      {children}
      {error ? (
        <span role="alert" className="block text-xs text-red-400">{error}</span>
      ) : hint ? (
        <span className="block text-xs text-faint">{hint}</span>
      ) : null}
    </label>
  );
}
