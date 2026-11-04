"use client";

import { useLinkStatus } from "next/link";

/**
 * Pending feedback for a wedding-hub card while the gallery behind it loads.
 *
 * The gallery routes have no `loading.tsx` on purpose: a route-level fallback
 * starts streaming before the page has resolved the share link, so its
 * `notFound()` and `redirect()` would turn into a 200 with a `noindex` tag and
 * a client-side meta refresh (Next 16 docs, loading.md "Status codes") — and
 * the link contract in docs/GALLERY-LOADING.md relies on both. So the card that
 * was tapped says "loading" itself, via `useLinkStatus` (must sit inside the
 * `<Link>`).
 *
 * The layer is always rendered and toggled by opacity, so it never shifts the
 * card's layout; the spinner inside it exists only while pending.
 * The spinner carries `.motion-loop`: it is feedback, not decoration, and keeps
 * turning (slowly) under reduced motion — see globals.css.
 */
export function LinkPending({ className = "" }: { className?: string }) {
  const { pending } = useLinkStatus();
  return (
    <span
      aria-hidden
      className={`duration-flip pointer-events-none flex items-center justify-center transition-opacity ${
        pending ? "opacity-100" : "opacity-0"
      } ${className}`}
    >
      {pending && (
        <span className="motion-loop size-6 animate-spin rounded-full border-2 border-current border-t-transparent" />
      )}
    </span>
  );
}
