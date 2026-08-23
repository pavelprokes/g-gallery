/**
 * A readable URL hint, e.g. `/g/{token}/svatba-petra-a-jana-2026-08-12`.
 *
 * Built from `title` *and* `eventDate` — the date lives in its own field,
 * not in the title, so a slug built from the title alone would drop the one
 * piece of information (which event, which day) that makes a URL
 * recognisable at a glance in a browser history or an inbox.
 *
 * Frozen at share-link creation (`docs/TODO.md` §6): stored on `ShareLink`,
 * not recomputed per request. A later rename doesn't invalidate an
 * already-sent link — the token is still the sole resolver — it just means
 * the frozen slug stops matching the gallery's current title, the same
 * trade-off Notion and Figma make.
 */

/** Trailing path segment, never the resolver — see `docs/TODO.md` §6 for why
 * a slug never goes *before* the token. */
export function gallerySlug(title: string, eventDate: Date | null): string {
  const titlePart = slugify(title);
  const datePart = eventDate ? isoDate(eventDate) : null;

  const parts = [titlePart, datePart].filter((p): p is string => Boolean(p));
  return parts.join("-") || "galerie";
}

/** Diacritics stripped, lowercased, non-alphanumerics collapsed to dashes.
 * Also used for a gallery's per-wedding key (docs/GUEST-GALLERIES.md §4), so
 * both kinds of readable segment are built the same way. */
export function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip combining diacritics after NFD
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
