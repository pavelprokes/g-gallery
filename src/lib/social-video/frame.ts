// One frame of a social video (docs/SOCIAL-VIDEO.md §2.4). The admin's live
// preview and the encoder both call `drawFrame`, so what the photographer
// watches is what the file holds.

import { cameraAt, ease, type Shot, type VideoFormat } from "@/lib/social-video/camera";
import { slidesAt, type Timeline } from "@/lib/social-video/timeline";

/** The canvas API a frame needs — a 2D context of a canvas or an OffscreenCanvas. */
export type FrameContext = Pick<
  CanvasRenderingContext2D,
  | "drawImage"
  | "fillRect"
  | "globalAlpha"
  | "fillStyle"
  | "imageSmoothingEnabled"
  | "imageSmoothingQuality"
>;

/** A decoded photo — an ImageBitmap, or anything drawable that knows its size. */
export type FrameImage = CanvasImageSource & { width: number; height: number };

export interface FrameSlide {
  /** The decoded photo, at any scale; null while it is not decoded, and the
   * slide is then skipped. */
  image: FrameImage | null;
  /** The size the shot was planned in — the photo's own pixels. */
  width: number;
  height: number;
  shot: Shot;
  /** For a `fit` shot: the photo cropped to fill the frame, blurred and
   * darkened (`makeBackdrop`), drawn under the whole photo. */
  backdrop?: CanvasImageSource;
}

export interface FramePlan {
  format: VideoFormat;
  timeline: Timeline;
  slides: readonly FrameSlide[];
}

/** A `fit` slide grows this much over its time — still, but not frozen. */
const FIT_DRIFT = 0.03;

export function drawFrame(ctx: FrameContext, plan: FramePlan, t: number): void {
  const { width: W, height: H } = plan.format;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  for (const visible of slidesAt(plan.timeline, t)) {
    const slide = plan.slides[visible.index];
    if (!slide?.image) continue;
    ctx.globalAlpha = visible.alpha;
    drawSlide(ctx, slide, slide.image, visible.progress, W, H);
  }
  ctx.globalAlpha = 1;
}

function drawSlide(
  ctx: FrameContext,
  slide: FrameSlide,
  image: FrameImage,
  progress: number,
  W: number,
  H: number,
) {
  if (slide.shot.kind !== "fit") {
    // The shot is in the photo's pixels; the bitmap is whatever size was fetched.
    const s = image.width / slide.width;
    const cam = cameraAt(slide.shot, progress);
    ctx.drawImage(image, cam.x * s, cam.y * s, cam.w * s, cam.h * s, 0, 0, W, H);
    return;
  }
  if (slide.backdrop) ctx.drawImage(slide.backdrop, 0, 0, W, H);
  const scale = Math.min(W / slide.width, H / slide.height) * (1 + FIT_DRIFT * ease(progress));
  const w = slide.width * scale;
  const h = slide.height * scale;
  ctx.drawImage(image, (W - w) / 2, (H - h) / 2, w, h);
}

/** Where a `fit` slide's backdrop is drawn — the caller's canvas (a DOM canvas
 * in the page, an OffscreenCanvas in a worker). */
export interface BackdropCanvas {
  width: number;
  height: number;
  getContext(kind: "2d"): (FrameContext & { filter: string }) | null;
}

/**
 * The photo cropped to fill `canvas`, blurred and darkened, drawn once per
 * slide: a CSS blur this size on every frame would halve the render's speed.
 * Pass a small canvas (a quarter of the frame): the blur is cheaper there, and
 * scaled up to the frame it only gets softer, which it is meant to be.
 */
export function makeBackdrop(
  image: CanvasImageSource,
  width: number,
  height: number,
  canvas: BackdropCanvas,
): BackdropCanvas {
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  const scale = Math.max(canvas.width / width, canvas.height / height);
  const w = width * scale;
  const h = height * scale;
  ctx.filter = "blur(24px) brightness(0.55)";
  ctx.drawImage(image, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
  ctx.filter = "none";
  return canvas;
}
