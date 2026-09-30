import type { DetailsHTMLAttributes, FormHTMLAttributes, HTMLAttributes } from "react";

// A card is sometimes the form or the disclosure it contains, rather than a box
// drawn around one. Those two elements carry props no generic element has, so
// they are spliced in here instead of forcing call sites to wrap a Card in a
// <form> that adds a layout box for nothing.
type ElementExtras = Pick<FormHTMLAttributes<HTMLFormElement>, "action" | "method" | "noValidate"> &
  Pick<DetailsHTMLAttributes<HTMLDetailsElement>, "open">;

const CARD_CLASSES =
  "rounded-xl border border-admin-border bg-white dark:border-neutral-800 dark:bg-neutral-900";
const CARD_PADDING = "p-4 sm:p-5";

// Replaces the fourteen hand-typed "rounded-lg border p-4" panels across the
// admin portal with one definition, and swaps the default gray border for the
// brand's warm border tone. `as="section"` keeps the semantic element several
// call sites already relied on.
//
// `flush` drops the padding, for a list whose rows pad themselves. A `p-0` in
// `className` cannot do it: in the generated CSS `p-4` comes after `p-0` and
// wins, which left every such list double-indented on a phone.
export function Card({
  as: Tag = "div",
  flush = false,
  className = "",
  ...props
}: HTMLAttributes<HTMLElement> &
  Partial<ElementExtras> & {
    as?: "div" | "section" | "form" | "ul" | "details";
    flush?: boolean;
  }) {
  return <Tag className={`${CARD_CLASSES} ${flush ? "" : CARD_PADDING} ${className}`} {...props} />;
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
