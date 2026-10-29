// The couple's gift in one click (docs/SOCIAL-VIDEO.md §2, "Dárek"): the
// suggestion as it stands, faces found where missing, rendered and added to
// the gallery — the studio's own steps, without the editing in between.

import type { TimelinePosition } from "@/lib/gallery-chapters";
import { slugify } from "@/lib/gallery-slug";
import { FORMATS, type Aspect } from "@/lib/social-video/camera";
import { chooseCodec, encodeVideo } from "@/lib/social-video/encode";
import type { PhotoFaces } from "@/lib/social-video/faces";
import { drawFrame } from "@/lib/social-video/frame";
import { shotsFor } from "@/lib/social-video/shots";
import { SlideImages, type SlidePhoto } from "@/lib/social-video/slide-images";
import { suggestPhotos, type VideoCandidate } from "@/lib/social-video/suggest";
import {
  buildTimeline,
  photoCountFor,
  slidesToDecode,
  type Length,
} from "@/lib/social-video/timeline";
import { sourceUrl } from "@/components/admin/face-scan";

export interface GiftPhoto {
  id: string;
  objectKey: string;
  candidate: VideoCandidate;
}

export type GiftProgress =
  | { step: "photos"; done: number; total: number }
  | { step: "faces"; done: number; total: number }
  | { step: "render"; share: number };

/** The gallery only takes H.264 (docs/VIDEO.md); a browser without it cannot make the gift. */
export class NoH264Error extends Error {}

/** Photos fetched at once — the studio's own pace. */
const FETCH_CONCURRENCY = 4;

export async function makeGiftVideo({
  photos,
  faces,
  chapterStarts,
  aspect,
  length,
  title,
  findFaces,
  onFaces,
  onProgress,
  signal,
}: {
  photos: readonly GiftPhoto[];
  faces: Readonly<Record<string, PhotoFaces | null>>;
  chapterStarts: readonly TimelinePosition[];
  aspect: Aspect;
  length: Length;
  title: string;
  findFaces(blob: Blob): Promise<PhotoFaces>;
  /** Faces found on the way, for the caller to store and keep. */
  onFaces(entries: { photoId: string; faces: PhotoFaces }[]): void;
  onProgress(progress: GiftProgress): void;
  signal: AbortSignal;
}): Promise<File> {
  const format = FORMATS[aspect];
  if ((await chooseCodec(format.width, format.height)) !== "avc") throw new NoH264Error();

  const byId = new Map(photos.map((p) => [p.id, p]));
  const order = suggestPhotos(
    photos.map((p) => ({ ...p.candidate, faces: faces[p.id] ?? null })),
    chapterStarts,
    format,
    photoCountFor(length),
  );
  const slides: (SlidePhoto & { coupleTags: GiftPhoto["candidate"]["coupleTags"] })[] =
    order.flatMap((id) => {
      const photo = byId.get(id);
      const { width, height, coupleTags } = photo?.candidate ?? {};
      if (!photo || !width || !height) return [];
      return [
        {
          id,
          width,
          height,
          coupleTags,
          url: sourceUrl(photo.objectKey, { width, height }, format),
        },
      ];
    });

  const store = new SlideImages();
  try {
    // Every photo first: a gift with a hole in it is worse than no gift.
    let fetched = 0;
    const queue = [...slides];
    await Promise.all(
      Array.from({ length: FETCH_CONCURRENCY }, async () => {
        for (let p = queue.shift(); p && !signal.aborted; p = queue.shift()) {
          await store.fetch(p);
          onProgress({ step: "photos", done: ++fetched, total: slides.length });
        }
      }),
    );

    const known: Record<string, PhotoFaces | null> = { ...faces };
    const unknown = slides.filter((p) => !known[p.id]);
    const found: { photoId: string; faces: PhotoFaces }[] = [];
    for (const [i, p] of unknown.entries()) {
      if (signal.aborted) break;
      onProgress({ step: "faces", done: i, total: unknown.length });
      const result = await findFaces(await store.fetch(p));
      known[p.id] = result;
      found.push({ photoId: p.id, faces: result });
    }
    if (found.length > 0) onFaces(found);

    const timeline = buildTimeline(slides.length, length);
    const shots = shotsFor(slides, known, format, timeline);
    let windowKey = "";
    const blob = await encodeVideo({
      width: format.width,
      height: format.height,
      duration: timeline.duration,
      codec: "avc",
      signal,
      onProgress: (share) => onProgress({ step: "render", share }),
      drawAt: async (ctx, t) => {
        const wanted = slidesToDecode(timeline, slides, t);
        const key = wanted.map((p) => p.id).join();
        if (key !== windowKey) {
          windowKey = key;
          await store.keepOnly(wanted);
        }
        // A bitmap the browser emptied is decoded again (SlideImages.ensureDrawn).
        await store.ensureDrawn(wanted);
        drawFrame(
          ctx,
          {
            format,
            timeline,
            slides: slides.map((p, i) => ({
              image: store.imageOf(p.id),
              width: p.width,
              height: p.height,
              shot: shots[i]!,
              backdrop:
                shots[i]!.kind === "fit" ? (store.backdropOf(p.id) ?? undefined) : undefined,
            })),
          },
          t,
        );
      },
    });
    const name = `${slugify(title) || "video"}-${aspect === "9:16" ? "9x16" : "16x9"}-${length}s.mp4`;
    return new File([blob], name, { type: "video/mp4" });
  } finally {
    store.close();
  }
}
