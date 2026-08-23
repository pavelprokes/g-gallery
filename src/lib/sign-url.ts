import { SITE_ORIGIN } from "@/lib/site-url";

/**
 * The exact address a printed QR sign encodes (docs/GUEST-GALLERIES.md F7).
 *
 * Kept as pure, individually-tested functions on purpose: a wrong URL here has
 * no fallback and no error surfaces to anyone until the wedding (round-1 QA
 * finding). The two path shapes must never drift from the ones already used
 * to render `CopyableLink` on the admin pages (`/g/{token}/{slug}` and
 * `/s/{token}/{slug}`) — a sign that encodes something the admin UI doesn't
 * also display next to it would be undetectable at generation time.
 */

/** A standalone (or event-attached) gallery's own forwardable link. */
export function gallerySignPath(token: string, slug: string | null): string {
  return `/g/${token}/${slug ?? ""}`;
}

/**
 * The wedding page — the stable address docs/GUEST-GALLERIES.md §2 says a
 * printed sign should point at, because galleries under it come and go while
 * this address does not.
 */
export function eventSignPath(token: string, slug: string): string {
  return `/s/${token}/${slug}`;
}

/** A printed sign needs a full URL — there is no "current request" to resolve a path against. */
export function absoluteSignUrl(path: string): string {
  return `${SITE_ORIGIN}${path}`;
}
