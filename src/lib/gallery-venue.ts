/**
 * Galleries have no venue of their own; a gallery's header borrows its
 * wedding's. Not from a wedding the photographer trashed (its /s/ page is
 * already gone), and not when the gallery is dated a different day — an
 * engagement shoot attached to the wedding was not at the wedding venue.
 */
export function inheritsEventVenue(
  galleryDate: Date | null,
  event: { eventDate: Date | null; trashedAt: Date | null } | null,
): boolean {
  if (!event || event.trashedAt) return false;
  if (!galleryDate || !event.eventDate) return true;
  return galleryDate.toISOString().slice(0, 10) === event.eventDate.toISOString().slice(0, 10);
}
