// The camera for a whole video: one shot per slide, then directed together so
// pushes and pulls alternate (docs/SOCIAL-VIDEO.md §5). Shared by the studio
// and the one-click gift, so both draw the same video from the same photos.

import { directShots, planShot, type Shot, type VideoFormat } from "@/lib/social-video/camera";
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

export function shotsFor(
  photos: readonly ShotPhoto[],
  faces: Readonly<Record<string, PhotoFaces | null | undefined>>,
  format: VideoFormat,
  timeline: Timeline,
): Shot[] {
  const seconds = moveSeconds(timeline);
  return directShots(
    photos.map((p, i) =>
      planShot(
        {
          width: p.width,
          height: p.height,
          faces: focusFaces(faces[p.id]?.faces ?? [], p.coupleTags ?? []),
        },
        format,
        seconds[i] ?? seconds.at(-1) ?? 3,
      ),
    ),
    photos.map((p) => faces[p.id]?.faces.length ?? 0),
  );
}
