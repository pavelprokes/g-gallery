/**
 * Which galleries become cards on a wedding page, and in what order
 * (docs/GUEST-GALLERIES.md §2).
 *
 * Pure on purpose: the rule is a conjunction of five independent switches that
 * each have their own reason to be off, and getting it wrong either hides a
 * gallery the couple published or shows one they withdrew. Both are quiet
 * failures in a Server Component, so the decision is tested on its own.
 */
export interface EventGalleryRow {
  id: string;
  title: string;
  eventKey: string | null;
  position: number;
  listedOnEvent: boolean;
  status: string;
  trashedAt: Date | null;
  /** The ShareLink the owner designated for this card, if any. */
  eventLink: { revokedAt: Date | null; expiresAt: Date | null } | null;
}

export function isCardVisible(row: EventGalleryRow, now: Date): boolean {
  // No key means the gallery was never attached properly — it cannot even be
  // addressed as `{eventToken}~{eventKey}`, so a card would lead nowhere.
  if (!row.eventKey) return false;
  if (!row.listedOnEvent) return false;
  if (row.trashedAt) return false;
  // Same rule every share surface applies: an unpublished gallery 404s, so a
  // card for one would be a link the couple can see and nobody else can open.
  if (row.status !== "PUBLISHED") return false;

  // No designated link means no permissions to grant through — the card is not
  // clickable, so it is not shown.
  const link = row.eventLink;
  if (!link) return false;
  if (link.revokedAt) return false;
  if (link.expiresAt && link.expiresAt.getTime() <= now.getTime()) return false;

  return true;
}

/**
 * Ordered by the position the owner set. Ties fall back to the title so the
 * order is stable across renders rather than left to the database — several
 * galleries attached in one go all start at position 0.
 */
export function visibleEventCards<T extends EventGalleryRow>(rows: T[], now: Date): T[] {
  return rows
    .filter((row) => isCardVisible(row, now))
    .sort((a, b) => a.position - b.position || a.title.localeCompare(b.title, "cs"));
}
