import type { HTMLAttributes } from "react";

// The pill label used for statuses and counts. Replaces three hand-typed
// variants that had drifted apart (the unread counter on /admin, and the two
// visibility pills on a wedding's gallery list).
//
// Tones carry meaning, not decoration: `success` means a guest can see it,
// `muted` means they cannot, `danger` is a count that wants attention.
const TONE_CLASSES = {
  default: "bg-admin-accent-soft text-brand-primary-dark dark:bg-neutral-800 dark:text-neutral-200",
  muted: "bg-admin-surface-muted text-admin-muted dark:bg-neutral-800 dark:text-neutral-400",
  success: "bg-admin-success-soft text-admin-success dark:bg-emerald-950/40 dark:text-emerald-300",
  warning: "bg-admin-warning-soft text-admin-warning dark:bg-amber-950/40 dark:text-amber-200",
  danger: "bg-admin-danger text-white",
} as const;

type BadgeTone = keyof typeof TONE_CLASSES;

export function Badge({
  tone = "default",
  className = "",
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-bold whitespace-nowrap tabular-nums ${TONE_CLASSES[tone]} ${className}`}
      {...props}
    />
  );
}
