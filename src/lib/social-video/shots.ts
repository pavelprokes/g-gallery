// The camera for a whole video: one shot per slide, then directed together so
// pushes and pulls alternate (docs/SOCIAL-VIDEO.md §5). Shared by the studio
// and the one-click gift, so both draw the same video from the same photos.

import { directShots, planShot, type Shot, type VideoFormat } from "@/lib/social-video/camera";
import { aimFaces } from "@/lib/social-video/aim";
import { focusFaces, type Box } from "@/lib/social-video/face-tags";
import type { PhotoFaces } from "@/lib/social-video/faces";
import { moveSeconds, type Timeline } from "@/lib/social-video/timeline";

export interface ShotPhoto {
  id: string;
  width: number;
  height: number;
  /** Where the photographer named the couple (§4, "Who is who"). */
  coupleTags?: readonly Box[];
}

/** Wider (or taller) than the video by more than this counts as the other way round. */
const ACROSS_FROM = 1.1;

/** A landscape photo in a vertical video, or a portrait one in a landscape video. */
export function isAcross(photo: { width: number; height: number }, format: VideoFormat): boolean {
  const photoAspect = photo.width / photo.height;
  return format.width < format.height ? photoAspect >= ACROSS_FROM : photoAspect <= 1 / ACROSS_FROM;
}

export interface ShotsOptions {
  /** Show a photo turned the other way whole, over a blurred copy of itself,
   * instead of cutting the video's shape out of it (docs/SLIDESHOW-MAKER.md §2). */
  fitAcross?: boolean;
}

export function shotsFor(
  photos: readonly ShotPhoto[],
  faces: Readonly<Record<string, PhotoFaces | null | undefined>>,
  format: VideoFormat,
  timeline: Timeline,
  { fitAcross = false }: ShotsOptions = {},
): Shot[] {
  const seconds = moveSeconds(timeline);
  const aimed = photos.map((p) =>
    aimFaces(focusFaces(faces[p.id]?.faces ?? [], p.coupleTags ?? []), faces[p.id]?.focus),
  );
  return directShots(
    photos.map((p, i) =>
      fitAcross && isAcross(p, format)
        ? wholePhoto(p)
        : planShot(
            { width: p.width, height: p.height, faces: aimed[i]!, focus: faces[p.id]?.focus },
            format,
            seconds[i] ?? seconds.at(-1) ?? 3,
          ),
    ),
    // A detail in front of soft faces is not a group: counted as the camera aims.
    aimed.map((list) => list.length),
  );
}

function wholePhoto({ width, height }: { width: number; height: number }): Shot {
  const whole = { x: 0, y: 0, w: width, h: height };
  return { kind: "fit", from: whole, to: whole };
}
