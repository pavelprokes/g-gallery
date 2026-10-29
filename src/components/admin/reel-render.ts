// A reel to an MP4 (docs/REELS.md §6): every photo fetched at the full
// format's size and as far over it as its shot goes in, the music cut and faded, then the social video's own
// encoder, frame by frame, with the sound alongside — or none, for a song
// that was only listened to.

import { slugify } from "@/lib/gallery-slug";
import { reelAudio } from "@/lib/reels/audio";
import type { ReelVariant } from "@/lib/reels/variants";
import { shotZoom, type Shot, type VideoFormat } from "@/lib/social-video/camera";
import { encodeVideo, type EncodeCodec } from "@/lib/social-video/encode";
import type { PhotoFaces } from "@/lib/social-video/faces";
import { drawFrame, type FramePlan } from "@/lib/social-video/frame";
import { shotsFor } from "@/lib/social-video/shots";
import { SlideImages, type SlidePhoto } from "@/lib/social-video/slide-images";
import { slidesToDecode, type Timeline } from "@/lib/social-video/timeline";
import type { Box } from "@/lib/social-video/face-tags";
import { sourceUrl } from "@/components/admin/face-scan";

export interface ReelPhoto {
  id: string;
  objectKey: string;
  width: number;
  height: number;
  coupleTags?: readonly Box[];
}

/** Photos fetched at once — the studio's own pace. */
const FETCH_CONCURRENCY = 4;
/** Seconds of slides decoded ahead of the frame being encoded. */
const RENDER_AHEAD = 1;

/**
 * A reel's slides and their shots at `format` — the preview's or the file's.
 * The shots first: each photo is then fetched just large enough for how
 * close its own shot goes (docs/REELS.md §5), not every one at the most.
 */
export function reelSlides(
  variant: ReelVariant,
  photos: ReadonlyMap<string, ReelPhoto>,
  faces: Readonly<Record<string, PhotoFaces | null>>,
  format: VideoFormat,
): { slides: (SlidePhoto & { coupleTags?: readonly Box[] })[]; shots: Shot[] } {
  const chosen = variant.photoIds.flatMap((id) => {
    const photo = photos.get(id);
    return photo ? [photo] : [];
  });
  const shots = shotsFor(chosen, faces, format, variant.plan.timeline, { reel: true });
  const slides = chosen.map((photo, i) => ({
    id: photo.id,
    width: photo.width,
    height: photo.height,
    coupleTags: photo.coupleTags,
    url: sourceUrl(photo.objectKey, photo, format, shotZoom(photo, shots[i]!, format)),
  }));
  return { slides, shots };
}

export function reelFramePlan(
  store: SlideImages,
  slides: readonly SlidePhoto[],
  shots: ReturnType<typeof shotsFor>,
  format: VideoFormat,
  timeline: Timeline,
): FramePlan {
  return {
    format,
    timeline,
    slides: slides.map((p, i) => ({
      image: store.imageOf(p.id),
      width: p.width,
      height: p.height,
      shot: shots[i]!,
      backdrop: shots[i]!.kind === "fit" ? (store.backdropOf(p.id) ?? undefined) : undefined,
    })),
  };
}

export type RenderProgress =
  { step: "photos"; done: number; total: number } | { step: "render"; share: number };

export async function renderReel({
  variant,
  photos,
  faces,
  format,
  track,
  codec,
  title,
  onProgress,
  signal,
}: {
  variant: ReelVariant;
  photos: ReadonlyMap<string, ReelPhoto>;
  faces: Readonly<Record<string, PhotoFaces | null>>;
  format: VideoFormat;
  /** The song, or null for a reel without sound — its song is added in Instagram. */
  track: AudioBuffer | null;
  codec: EncodeCodec;
  title: string;
  onProgress(progress: RenderProgress): void;
  signal: AbortSignal;
}): Promise<File> {
  const { slides, shots } = reelSlides(variant, photos, faces, format);
  const { timeline } = variant.plan;
  const store = new SlideImages();
  try {
    // Every photo first: a cut to black on the beat is worse than a wait.
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
    signal.throwIfAborted();
    const audio = track
      ? await reelAudio(track, variant.plan.offset, timeline.duration, variant.plan.fadeOut)
      : undefined;
    let windowKey = "";
    const blob = await encodeVideo({
      width: format.width,
      height: format.height,
      duration: timeline.duration,
      codec,
      audio,
      signal,
      onProgress: (share) => onProgress({ step: "render", share }),
      drawAt: async (ctx, t) => {
        // The next second's photos decode alongside the frames being encoded.
        const wanted = slidesToDecode(timeline, slides, t, RENDER_AHEAD);
        const key = wanted.map((p) => p.id).join();
        if (key !== windowKey) {
          windowKey = key;
          await store.keepOnly(wanted);
        }
        drawFrame(ctx, reelFramePlan(store, slides, shots, format, timeline), t);
      },
    });
    const seconds = Math.round(timeline.duration);
    const name = `${slugify(title) || "reel"}-${slugify(variant.label)}-${seconds}s${track ? "" : "-bez-zvuku"}.mp4`;
    return new File([blob], name, { type: "video/mp4" });
  } finally {
    store.close();
  }
}
