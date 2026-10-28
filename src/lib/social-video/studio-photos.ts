import "server-only";

// A gallery's photos as the video tools take them (docs/SOCIAL-VIDEO.md §3):
// stills with a known size, in the gallery's order, each with its faces, the
// couple's tags and what the guests took to. Shared by the gallery's "Video
// pro sítě" and the reels page (docs/REELS.md), which reads several galleries.

import { compareTimeline } from "@/lib/gallery-chapters";
import { HIGHLIGHT_CANDIDATE_SELECT, toHighlightCandidate } from "@/lib/gallery-highlights";
import { positionOf, type PhotoOrder } from "@/lib/photo-order";
import { faceless, needsFocus } from "@/lib/social-video/aim";
import { currentFaces } from "@/lib/social-video/faces";
import { likedScore } from "@/lib/social-video/suggest";
import { photoCounts } from "@/lib/activity";
import { printTotals } from "@/lib/print-selections";
import { reactionTotals } from "@/lib/reactions";
import type { StudioPhoto } from "@/components/admin/social-video-studio";

/** Stills with a known size: the camera is planned in the photo's own pixels
 * before it is fetched. Films are not slides. */
export const STUDIO_PHOTO_WHERE = {
  status: "CONFIRMED",
  videoObjectKey: null,
  width: { not: null },
  height: { not: null },
} as const;

export const STUDIO_PHOTO_SELECT = {
  ...HIGHLIGHT_CANDIDATE_SELECT,
  objectKey: true,
  thumbObjectKey: true,
  fileName: true,
  width: true,
  height: true,
  placeholder: true,
  faces: true,
  faceTags: {
    where: { person: { couple: true } },
    select: { x: true, y: true, w: true, h: true },
  },
  _count: { select: { favorites: true } },
} as const;

type StudioPhotoRow = Parameters<typeof toHighlightCandidate>[1] & {
  objectKey: string;
  thumbObjectKey: string | null;
  fileName: string;
  width: number | null;
  height: number | null;
  placeholder: string | null;
  faces: unknown;
  faceTags: { x: number; y: number; w: number; h: number }[];
  _count: { favorites: number };
};

export interface GuestTallies {
  viewers: Awaited<ReturnType<typeof photoCounts>>;
  reactions: Map<string, number>;
  prints: Map<string, number>;
}

/** What the guests took to (docs/SOCIAL-VIDEO.md §3) — the same tallies the
 * gallery's own admin page shows — for one gallery or several in one go. */
export async function guestTallies(galleryIds: readonly string[]): Promise<GuestTallies> {
  const [viewers, reactions, prints] = await Promise.all([
    photoCounts(galleryIds),
    reactionTotals(galleryIds),
    printTotals(galleryIds),
  ]);
  return { viewers, reactions, prints };
}

/** The rows of one gallery, sorted and scored. */
export function toStudioPhotos(
  order: PhotoOrder,
  rows: readonly StudioPhotoRow[],
  { viewers, reactions, prints }: GuestTallies,
): StudioPhoto[] {
  return rows
    .toSorted((a, b) => compareTimeline(positionOf(order, a), positionOf(order, b)))
    .map((photo) => ({
      id: photo.id,
      objectKey: photo.objectKey,
      thumbObjectKey: photo.thumbObjectKey,
      fileName: photo.fileName,
      placeholder: photo.placeholder,
      candidate: {
        ...toHighlightCandidate(order, photo),
        width: photo.width,
        height: photo.height,
        // A faceless photo is unknown to the studio until its sharp part is
        // looked for, so its own scan fills it in (docs/SOCIAL-VIDEO.md §5).
        // Soft-faced ones keep their faces here; the gallery page's scan
        // adds their focus without the suggestion losing them meanwhile.
        faces: ((f) => (f && faceless(f) && needsFocus(f) ? null : f))(currentFaces(photo.faces)),
        coupleTags: photo.faceTags,
        liked: likedScore({
          favorites: photo._count.favorites,
          reactions: reactions.get(photo.id) ?? 0,
          printCopies: prints.get(photo.id) ?? 0,
          uniqueViewers: viewers.get(photo.id)?.uniqueViewers ?? 0,
        }),
      },
    }));
}
