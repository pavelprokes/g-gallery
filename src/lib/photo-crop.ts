// The geometry of a photo_crop request (docs/MCP.md §Crops): which rectangle of
// the photo to keep and how large to deliver it. The client decides where to
// cut — an aspect with a gravity, or an exact rectangle; nothing here looks at
// the picture. Pure; rectangles are in the photo's own (EXIF-oriented) pixels.

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Which part of the photo an aspect crop keeps: an edge, the centre, or a
 * point (0–1 of the photo) the crop is centred on as far as it can be. */
export type Gravity = "center" | "top" | "bottom" | "left" | "right" | { x: number; y: number };

export interface CropRequest {
  /** Width over height; null keeps the photo's own (or the rectangle's). */
  aspect: number | null;
  gravity: Gravity;
  /** An exact cut-out, as shares 0–1 of the photo; wins over the gravity. */
  rect: Rect | null;
  maxWidth: number | null;
  maxHeight: number | null;
  allowUpscale: boolean;
}

export interface CropPlan {
  rect: Rect;
  output: { width: number; height: number };
  warnings: string[];
}

/** Aspects a client may name; any other "W:H" is accepted too. */
export const NAMED_ASPECTS: Record<string, number> = {
  "4:5": 4 / 5,
  "1:1": 1,
  "1.91:1": 1.91,
  "9:16": 9 / 16,
  "16:9": 16 / 9,
  "3:4": 3 / 4,
  "4:3": 4 / 3,
  "2:3": 2 / 3,
  "3:2": 3 / 2,
};

export const MIN_ASPECT = 0.25;
export const MAX_ASPECT = 4;

/** "4:5", "1.91:1", "original" → width over height (null = the photo's own). */
export function parseAspect(value: string): number | null {
  if (value === "original") return null;
  const named = NAMED_ASPECTS[value];
  if (named) return named;
  const match = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(value);
  if (!match) throw new Error("ASPECT");
  const aspect = Number(match[1]) / Number(match[2]);
  if (!Number.isFinite(aspect) || aspect < MIN_ASPECT || aspect > MAX_ASPECT)
    throw new Error("ASPECT");
  return aspect;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), Math.max(min, max));
}

/** Where along a free span of `room` pixels the crop starts, for a gravity. */
function offset(gravity: Gravity, axis: "x" | "y", room: number, size: number, full: number) {
  if (typeof gravity === "object") return clamp(gravity[axis] * full - size / 2, 0, room);
  const start = axis === "x" ? "left" : "top";
  const end = axis === "x" ? "right" : "bottom";
  if (gravity === start) return 0;
  if (gravity === end) return room;
  return room / 2;
}

/** The largest rectangle of `aspect` inside W × H, placed by `gravity`. */
function aspectRect(W: number, H: number, aspect: number, gravity: Gravity): Rect {
  let w = Math.min(W, Math.round(H * aspect));
  let h = Math.round(w / aspect);
  if (h > H) {
    h = H;
    w = Math.min(W, Math.round(H * aspect));
  }
  return {
    x: Math.round(offset(gravity, "x", W - w, w, W)),
    y: Math.round(offset(gravity, "y", H - h, h, H)),
    w,
    h,
  };
}

/** Whole pixels of a 0–1 rectangle, at least one pixel, inside the photo. */
function exactRect(W: number, H: number, share: Rect): Rect {
  const x = clamp(Math.round(share.x * W), 0, W - 1);
  const y = clamp(Math.round(share.y * H), 0, H - 1);
  return {
    x,
    y,
    w: clamp(Math.round(share.w * W), 1, W - x),
    h: clamp(Math.round(share.h * H), 1, H - y),
  };
}

export function planCrop(size: { width: number; height: number }, request: CropRequest): CropPlan {
  const { width: W, height: H } = size;
  const warnings: string[] = [];
  let rect = request.rect
    ? exactRect(W, H, request.rect)
    : request.aspect === null
      ? { x: 0, y: 0, w: W, h: H }
      : aspectRect(W, H, request.aspect, request.gravity);
  // A rectangle of another shape is cut to the asked aspect around its centre.
  if (request.rect && request.aspect !== null) {
    const inner = aspectRect(rect.w, rect.h, request.aspect, "center");
    if (inner.w !== rect.w || inner.h !== rect.h) {
      rect = { ...inner, x: rect.x + inner.x, y: rect.y + inner.y };
      warnings.push("Obdélník neměl zadaný poměr stran — je oříznutý kolem svého středu.");
    }
  }

  const a = request.aspect ?? rect.w / rect.h;
  const limitW = request.maxWidth ?? Infinity;
  const limitH = request.maxHeight ?? Infinity;
  const fit = Math.min(limitW / rect.w, limitH / rect.h);
  const scale = request.allowUpscale && Number.isFinite(fit) ? fit : Math.min(1, fit);
  let width = Math.max(1, Math.round(rect.w * scale));
  let height = Math.max(1, Math.round(width / a));
  if (height > limitH) {
    height = Math.floor(limitH);
    width = Math.max(1, Math.round(height * a));
  }
  if (!request.allowUpscale && Number.isFinite(fit) && fit > 1) {
    warnings.push(
      `Výřez má jen ${rect.w} × ${rect.h} px, menší než požadovaná velikost — nezvětšuji ho (allow_upscale).`,
    );
  }
  return { rect, output: { width, height }, warnings };
}

/** The output scaled by `factor`, keeping its aspect, never below 1 px. */
export function shrink(output: { width: number; height: number }, factor: number) {
  const width = Math.max(1, Math.floor(output.width * factor));
  return { width, height: Math.max(1, Math.round((width * output.height) / output.width)) };
}
