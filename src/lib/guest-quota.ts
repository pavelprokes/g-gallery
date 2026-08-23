/**
 * Caps on what a guest share link can put into a gallery
 * (docs/GUEST-GALLERIES.md §8).
 *
 * A guest-upload link is an anonymous write path into our storage and links get
 * forwarded, so "how much can arrive" has to be bounded by something other than
 * good manners.
 *
 * Honest about what each cap is worth:
 *
 * - The **per-gallery** cap is the real limit. It is enforced against rows in
 *   the database and nothing a client does can move it.
 * - The **per-viewer** cap is keyed on the first-party `anonKey`, which lives in
 *   the guest's own localStorage. Clearing site data yields a new one. That
 *   makes it a guardrail against one person accidentally dumping their entire
 *   camera roll, not a defence against someone determined — the gallery cap is
 *   what stops that. Documented rather than pretended otherwise.
 */
export const GUEST_MAX_FILES_PER_VIEWER = 150;
export const GUEST_MAX_FILES_PER_GALLERY = 2000;

/**
 * Per-file ceiling for guests: generous for a phone photo (a 48 Mpx HEIC
 * converted to JPEG lands well under this) and far below the 100 MB the
 * photographer's own exports are allowed, so a mis-picked video cannot occupy
 * an upload slot for minutes before being rejected.
 */
export const GUEST_MAX_FILE_BYTES = 25 * 1024 * 1024;

export type GuestQuotaDenial = "GALLERY_FULL" | "VIEWER_FULL";

export interface GuestQuotaVerdict {
  ok: boolean;
  reason?: GuestQuotaDenial;
  /** How many more files would still fit — 0 when the cap is already reached. */
  remaining: number;
}

/**
 * Counts passed in are of rows that already exist (PENDING *and* CONFIRMED):
 * presigning creates the row, so counting only confirmed uploads would let a
 * client presign without limit and never check anything back in.
 */
export function checkGuestQuota(input: {
  galleryUsed: number;
  viewerUsed: number;
  requested: number;
  perViewer?: number;
  perGallery?: number;
}): GuestQuotaVerdict {
  const perViewer = input.perViewer ?? GUEST_MAX_FILES_PER_VIEWER;
  const perGallery = input.perGallery ?? GUEST_MAX_FILES_PER_GALLERY;

  const galleryLeft = Math.max(0, perGallery - input.galleryUsed);
  const viewerLeft = Math.max(0, perViewer - input.viewerUsed);
  const remaining = Math.min(galleryLeft, viewerLeft);

  if (input.requested <= remaining) return { ok: true, remaining };

  // Report whichever ceiling actually bites, so the message can name it.
  return {
    ok: false,
    reason: galleryLeft <= viewerLeft ? "GALLERY_FULL" : "VIEWER_FULL",
    remaining,
  };
}

/**
 * Requests-per-minute guardrail, independent of the total caps above: those
 * bound how much can ever land in a gallery, this bounds how fast one
 * `anonKey` can hit the presign endpoint. 80/minute clears a guest dumping
 * their whole camera roll in one go (well under a minute at the client's
 * 8-file batch size) while still bounding a script that would otherwise
 * create unlimited PENDING rows.
 */
export const GUEST_RATE_LIMIT_WINDOW_MS = 60_000;
export const GUEST_RATE_LIMIT_MAX_PER_WINDOW = 80;

export function checkGuestRateLimit(input: {
  recentCount: number;
  requested: number;
  max?: number;
}): boolean {
  const max = input.max ?? GUEST_RATE_LIMIT_MAX_PER_WINDOW;
  return input.recentCount + input.requested <= max;
}
