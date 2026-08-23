import type { ButtonHTMLAttributes } from "react";

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
