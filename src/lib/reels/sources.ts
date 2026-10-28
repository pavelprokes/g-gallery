// Which galleries a reel is made from lives in the address (docs/REELS.md §4),
// so a reload or a bookmark keeps the choice.

/** More would load every photo of a season into one page. */
export const MAX_REEL_GALLERIES = 10;

export function reelsHref(galleryIds: readonly string[]): string {
  return galleryIds.length > 0 ? `/admin/reels?g=${galleryIds.join(",")}` : "/admin/reels";
}
