import type { DetailsHTMLAttributes, FormHTMLAttributes, HTMLAttributes } from "react";

// A card is sometimes the form or the disclosure it contains, rather than a box
// drawn around one. Those two elements carry props no generic element has, so
// they are spliced in here instead of forcing call sites to wrap a Card in a
// <form> that adds a layout box for nothing.
type ElementExtras = Pick<FormHTMLAttributes<HTMLFormElement>, "action" | "method" | "noValidate"> &
  Pick<DetailsHTMLAttributes<HTMLDetailsElement>, "open">;

const CARD_CLASSES =
  "rounded-xl border border-admin-border bg-white p-4 sm:p-5 dark:border-neutral-800 dark:bg-neutral-900";

// Replaces the fourteen hand-typed "rounded-lg border p-4" panels across the
// admin portal with one definition, and swaps the default gray border for the
// brand's warm border tone. `as="section"` keeps the semantic element several
// call sites already relied on.
export function Card({
  as: Tag = "div",
  className = "",
  ...props
}: HTMLAttributes<HTMLElement> &
  Partial<ElementExtras> & { as?: "div" | "section" | "form" | "ul" | "details" }) {
  return <Tag className={`${CARD_CLASSES} ${className}`} {...props} />;
}

/**
 * The small uppercase section label above a panel's contents ("ODKAZY PRO HOSTY").
 * Muted and letterspaced rather than large and dark: it names the panel without
 * competing with the page's own `<h1>`. Defaults to `h2` — pass `as="h3"` where
 * the panel is already nested under one.
 */
export function CardTitle({
  as: Tag = "h2",
  className = "",
  ...props
}: HTMLAttributes<HTMLHeadingElement> & { as?: "h2" | "h3" }) {
  return (
    <Tag
      className={`text-admin-muted mb-4 text-sm font-bold tracking-wide uppercase dark:text-neutral-400 ${className}`}
      {...props}
    />
  );
}
