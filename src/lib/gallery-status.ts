/**
 * The `GalleryStatus` enum as the photographer would say it, plus what it means
 * for a guest: `success` = they can see it, `muted` = they cannot.
 *
 * Shared rather than typed out per page: the overview and the wedding page both
 * show it, and the one thing worse than a raw `DRAFT` in the UI is two pages
 * translating it differently.
 */
export const GALLERY_STATUS = {
  PUBLISHED: { label: "Publikováno", tone: "success" },
  DRAFT: { label: "Koncept", tone: "muted" },
  ARCHIVED: { label: "Archiv", tone: "muted" },
} as const;
