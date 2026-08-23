import type { HTMLAttributes } from "react";

const CARD_CLASSES =
  "rounded-lg border border-brand-border/60 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900";

// Replaces the fourteen hand-typed "rounded-lg border p-4" panels across the
// admin portal with one definition, and swaps the default gray border for the
// brand's warm border tone. `as="section"` keeps the semantic element several
// call sites already relied on.
export function Card({
  as: Tag = "div",
  className = "",
  ...props
}: HTMLAttributes<HTMLElement> & { as?: "div" | "section" }) {
  return <Tag className={`${CARD_CLASSES} ${className}`} {...props} />;
}
