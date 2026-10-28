// A reel to an MP4 (docs/REELS.md §5): every photo fetched at the full
// format's size, the music cut and faded, then the social video's own
// encoder, frame by frame, with the sound alongside — or none, for a song
// that was only listened to.

import { slugify } from "@/lib/gallery-slug";
import { reelAudio } from "@/lib/reels/audio";
import type { ReelVariant } from "@/lib/reels/variants";
import type { VideoFormat } from "@/lib/social-video/camera";
import { encodeVideo, type EncodeCodec } from "@/lib/social-video/encode";
import type { PhotoFaces } from "@/lib/social-video/faces";
import { drawFrame, type FramePlan } from "@/lib/social-video/frame";
import { shotsFor } from "@/lib/social-video/shots";
import { SlideImages, type SlidePhoto } from "@/lib/social-video/slide-images";
import { slidesAt, type Timeline } from "@/lib/social-video/timeline";
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

/** A reel's slides, fetched at `format`'s size — the preview's or the file's. */
export function reelSlides(
  variant: ReelVariant,
  photos: ReadonlyMap<string, ReelPhoto>,
  format: VideoFormat,
): (SlidePhoto & { coupleTags?: readonly Box[] })[] {
  return variant.photoIds.flatMap((id) => {
    const photo = photos.get(id);
    if (!photo) return [];
    return [
      {
        id,
        width: photo.width,
        height: photo.height,
        coupleTags: photo.coupleTags,
        url: sourceUrl(photo.objectKey, photo, format),
      },
    ];
  });
}

/** The photos on screen at `t` and the one after — what must be decoded. */
export function onScreen<T>(timeline: Timeline, slides: readonly T[], t: number): T[] {
  const visible = slidesAt(timeline, t).map((v) => v.index);
  const next = visible.length > 0 ? Math.max(...visible) + 1 : 0;
  return [...new Set([...visible, next])]
    .filter((i) => i >= 0 && i < slides.length)
    .map((i) => slides[i]!);
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

/** How long the test flash stays on a beat — two frames at 30 fps. */
const FLASH_SECONDS = 2 / 30;

/**
 * The beats of the reel's music in the video's own time — for the test that
 * shows where Instagram starts its music (docs/INSTAGRAM-PUBLISH.md §2, U2).
 */
export function beatsInVideo(beats: readonly number[], offset: number, duration: number): number[] {
  return beats.map((b) => b - offset).filter((t) => t >= 0 && t < duration);
}

/** A white flash over the frame on each beat, if `t` is on one. */
export function drawBeatFlash(
  ctx: CanvasRenderingContext2D,
  flashes: readonly number[],
  t: number,
  width: number,
  height: number,
): void {
  // From the frame nearest the beat — the same rounding the cuts use.
  const lead = 1 / 60;
  if (!flashes.some((b) => t >= b - lead && t < b - lead + FLASH_SECONDS)) return;
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  ctx.globalAlpha = 1;
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
  flashes,
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
  /** Beats to flash on (`beatsInVideo`) — the sync test; none for a real reel. */
  flashes?: readonly number[];
  onProgress(progress: RenderProgress): void;
  signal: AbortSignal;
}): Promise<File> {
  const slides = reelSlides(variant, photos, format);
  const { timeline } = variant.plan;
  const shots = shotsFor(slides, faces, format, timeline);
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
        const wanted = onScreen(timeline, slides, t);
        const key = wanted.map((p) => p.id).join();
        if (key !== windowKey) {
          windowKey = key;
          await store.keepOnly(wanted);
        }
        drawFrame(ctx, reelFramePlan(store, slides, shots, format, timeline), t);
        if (flashes) drawBeatFlash(ctx, flashes, t, format.width, format.height);
      },
    });
    const seconds = Math.round(timeline.duration);
    const name = `${slugify(title) || "reel"}-${slugify(variant.label)}-${seconds}s${flashes ? "-test-dob" : ""}${track ? "" : "-bez-zvuku"}.mp4`;
    return new File([blob], name, { type: "video/mp4" });
  } finally {
    store.close();
  }
}
