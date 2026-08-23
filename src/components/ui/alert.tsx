import type { HTMLAttributes } from "react";

// Warning stays amber and danger stays red — both are universal semantic
// colors, not brand colors, so there's no reason to retint them. This just
// collapses the eight-plus hand-typed copies of these two banners into one
// definition.
const TONE_CLASSES = {
  warning: "border-amber-400 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800",
  danger: "border-red-400 bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300",
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
      className={`rounded border ${compact ? "p-2 text-xs" : "p-3 text-sm"} ${TONE_CLASSES[tone]} ${className}`}
      {...props}
    />
  );
}
