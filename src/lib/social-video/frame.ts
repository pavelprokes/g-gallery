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
  /** For a `fit` shot: the colour around the whole photo — dark and muted,
   * taken from the photo (`backdropColor`). Black without it. */
  backdrop?: string;
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
  // The frame is already black; a colour of the photo, when there is one,
  // fades in and out with the slide.
  if (slide.backdrop) {
    ctx.fillStyle = slide.backdrop;
    ctx.fillRect(0, 0, W, H);
  }
  const scale = Math.min(W / slide.width, H / slide.height) * (1 + FIT_DRIFT * ease(progress));
  const w = slide.width * scale;
  const h = slide.height * scale;
  ctx.drawImage(image, (W - w) / 2, (H - h) / 2, w, h);
}

/** The average colour of RGBA pixels, 0–255 per channel. */
export function averageColor(rgba: ArrayLike<number>): [number, number, number] {
  const sum = [0, 0, 0];
  const n = Math.floor(rgba.length / 4);
  for (let i = 0; i < n; i++) {
    sum[0]! += rgba[i * 4]!;
    sum[1]! += rgba[i * 4 + 1]!;
    sum[2]! += rgba[i * 4 + 2]!;
  }
  return n > 0 ? [sum[0]! / n, sum[1]! / n, sum[2]! / n] : [0, 0, 0];
}

/** The most colour and light a backdrop keeps: a hint of the photo's tone,
 * never a colour that competes with the photo itself. */
const BACKDROP_MAX_SATURATION = 0.15;
const BACKDROP_LIGHTNESS = { min: 0.06, max: 0.16 };

/**
 * The colour behind a photo shown whole: its average, nearly grey and dark.
 * A blurred copy of the photo did this before — but Safari's canvas ignores
 * `filter`, so there the copy came out sharp and bright, and the photo
 * appeared twice (docs/SOCIAL-VIDEO.md §5).
 */
export function backdropColor([r, g, b]: [number, number, number]): string {
  const [h, s, l] = toHsl(r / 255, g / 255, b / 255);
  const muted = Math.min(s * 0.5, BACKDROP_MAX_SATURATION);
  const dark = Math.min(BACKDROP_LIGHTNESS.max, Math.max(BACKDROP_LIGHTNESS.min, l * 0.3));
  const [rr, gg, bb] = fromHsl(h, muted, dark);
  return `rgb(${Math.round(rr * 255)}, ${Math.round(gg * 255)}, ${Math.round(bb * 255)})`;
}

function toHsl(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h =
    max === r
      ? ((g - b) / d + (g < b ? 6 : 0)) / 6
      : max === g
        ? ((b - r) / d + 2) / 6
        : ((r - g) / d + 4) / 6;
  return [h, s, l];
}

function fromHsl(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number) => {
    const u = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
    if (u < 1 / 6) return p + (q - p) * 6 * u;
    if (u < 1 / 2) return q;
    if (u < 2 / 3) return p + (q - p) * (2 / 3 - u) * 6;
    return p;
  };
  return [channel(h + 1 / 3), channel(h), channel(h - 1 / 3)];
}
