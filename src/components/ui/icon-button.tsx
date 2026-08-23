import type { AnchorHTMLAttributes, ButtonHTMLAttributes } from "react";

const ICON_BUTTON_CLASSES =
  "flex h-11 w-11 items-center justify-center rounded-full border border-neutral-300 text-neutral-700 transition-colors hover:border-brand-primary hover:bg-brand-tint disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-neutral-300 disabled:hover:bg-transparent dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800";

/**
 * Circular icon-only control for light backgrounds (gallery header toolbar) —
 * same icon set and touch-target size as the lightbox's chrome (NavButton,
 * below), but light chrome instead of the lightbox's white-on-black, since
 * the lightbox's `hover:bg-white/15` reads as invisible outside a photo.
 * Always pair with `aria-label`: no visible text ships with the icon.
 */
export function IconButton({
  className = "",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={`${ICON_BUTTON_CLASSES} ${className}`} {...props}>
      {children}
    </button>
  );
}

/** Same chrome as `IconButton`, for a plain download link (a pre-built ZIP is a CDN URL, not a click handler). */
export function IconButtonLink({
  className = "",
  children,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a className={`${ICON_BUTTON_CLASSES} ${className}`} {...props}>
      {children}
    </a>
  );
}

/**
 * Prev/next lightbox navigation. The visible circle stays 48px, but the
 * clickable element is a bigger, invisible 80px zone around it — a near-edge
 * tap that misses the icon by a few pixels still fires the navigation,
 * which matters most one-handed on a phone.
 */
export function NavButton({
  className = "",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={`group flex h-20 w-20 shrink-0 items-center justify-center text-white disabled:opacity-40 ${className}`}
      {...props}
    >
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-black/40 backdrop-blur-sm transition-colors group-hover:bg-black/55">
        {children}
      </span>
    </button>
  );
}
