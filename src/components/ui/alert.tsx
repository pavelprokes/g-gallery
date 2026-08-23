import type { HTMLAttributes } from "react";

// Warning stays amber, danger stays red, success stays green — all three are
// universal semantic colors, not brand colors. They are tinted to the warm
// palette the admin portal on the main site uses (svatebni-fotograf-cechy-2.0
// components/Admin/ui.ts `alertToneStyles`) so a banner sits on cream without
// looking pasted on, but they still read as warning/error/ok at a glance.
//
// `info` is the neutral beige strip — a statement of fact, not a problem.
const TONE_CLASSES = {
  info: "border-admin-border bg-admin-accent-soft text-brand-primary-dark dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200",
  warning:
    "border-admin-warning-border bg-admin-warning-soft text-admin-warning dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200",
  danger:
    "border-admin-danger-border bg-admin-danger-soft text-admin-danger dark:border-red-900 dark:bg-red-950/30 dark:text-red-300",
  success:
    "border-admin-success-border bg-admin-success-soft text-admin-success dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300",
} as const;

type AlertTone = keyof typeof TONE_CLASSES;

export function Alert({
  tone = "warning",
  compact = false,
  className = "",
  ...props
}: HTMLAttributes<HTMLDivElement> & { tone?: AlertTone; compact?: boolean }) {
  return (
    <div
      className={`rounded-lg border leading-relaxed ${compact ? "px-3 py-2 text-xs" : "px-3.5 py-3 text-sm"} ${TONE_CLASSES[tone]} ${className}`}
      {...props}
    />
  );
}
