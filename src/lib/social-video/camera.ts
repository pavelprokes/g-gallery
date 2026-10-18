// The camera move of one slide (docs/SOCIAL-VIDEO.md §5): where it starts and
// ends in the photo, and where it is at any moment between. Pure and
// client-safe; every rectangle is in the photo's own pixels.

import type { Face } from "@/lib/social-video/faces";

export type Aspect = "9:16" | "16:9";

export interface VideoFormat {
  aspect: Aspect;
  width: number;
  height: number;
  /** The most the tight frame may be zoomed in on the cover frame — a small
   * zoom looks expensive, a big one cheap. */
  maxZoom: number;
  /** Where the eyes sit, as a share of the frame's height from the top. */
  eyeLine: number;
  /** Where eyes must stay, as shares of the frame — on 9:16 clear of the
   * Reels caption and buttons. */
  safe: { x0: number; x1: number; y0: number; y1: number };
}

export const FORMATS: Record<Aspect, VideoFormat> = {
  "9:16": {
    aspect: "9:16",
    width: 1080,
    height: 1920,
    maxZoom: 1.25,
    eyeLine: 0.38,
    safe: { x0: 0.06, x1: 0.86, y0: 0.14, y1: 0.65 },
  },
  "16:9": {
    aspect: "16:9",
    width: 1920,
    height: 1080,
    maxZoom: 1.35,
    eyeLine: 0.4,
    safe: { x0: 0.05, x1: 0.95, y0: 0.05, y1: 0.95 },
  },
};

/** Faster than this reads as seasick on a phone: scale per second… */
const SCALE_MAX_PER_S = 0.08;
/** …and pan, in frame widths per second. */
const PAN_MAX_PER_S = 0.35;

/** A face counts for framing from this score, and from this share of the
 * largest face's area — a stranger far behind the couple does not. */
const FRAMING_MIN_SCORE = 0.6;
const FRAMING_MIN_AREA = 0.15;

/** Head and shoulders around a face box, in face heights and widths. */
const HEADROOM = 0.8;
const BELOW_FACE = 1.0;
const BESIDE_FACE = 0.4;

/** Air around the subject in the tight frame. */
const TIGHT_MARGIN = 1.08;

/** The least a push moves — below it a slide reads as a frozen frame. */
const MIN_ZOOM = 1.06;

/** Up to this many people a too-wide subject is panned across; more is a
 * group, shown whole. */
const MAX_PANNED_FACES = 3;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * - `push` / `pull`: from the cover frame in to the tight one, or out;
 * - `pan`: across a subject wider than the crop, at a constant zoom;
 * - `fit`: the whole photo over a blurred copy of itself, barely moving.
 */
export type ShotKind = "push" | "pull" | "pan" | "fit";

export interface Shot {
  kind: ShotKind;
  from: Rect;
  to: Rect;
}

export interface PhotoForShot {
  width: number;
  height: number;
  faces: readonly Face[];
}

interface Subject {
  box: Rect;
  eyeY: number;
  faces: Face[];
}

/** The faces that frame the photo, widened to head and shoulders, as one box. */
export function subjectOf(photo: PhotoForShot): Subject | null {
  const strong = photo.faces.filter((f) => f.score >= FRAMING_MIN_SCORE);
  if (strong.length === 0) return null;
  const largest = Math.max(...strong.map((f) => f.w * f.h));
  const faces = strong.filter((f) => f.w * f.h >= largest * FRAMING_MIN_AREA);

  const { width: W, height: H } = photo;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const f of faces) {
    const head = headAndShoulders(f, W, H);
    x0 = Math.min(x0, head.x);
    y0 = Math.min(y0, head.y);
    x1 = Math.max(x1, head.x + head.w);
    y1 = Math.max(y1, head.y + head.h);
  }
  const eyeY = (faces.reduce((sum, f) => sum + (f.le[1] + f.re[1]) / 2, 0) / faces.length) * H;
  return { box: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, eyeY, faces };
}

function headAndShoulders(f: Face, W: number, H: number): Rect {
  const x = Math.max(0, (f.x - f.w * BESIDE_FACE) * W);
  const y = Math.max(0, (f.y - f.h * HEADROOM) * H);
  const x1 = Math.min(W, (f.x + f.w * (1 + BESIDE_FACE)) * W);
  const y1 = Math.min(H, (f.y + f.h * (1 + BELOW_FACE)) * H);
  return { x, y, w: x1 - x, h: y1 - y };
}

/**
 * The slide's move, before its direction is chosen: `from` is always the wider
 * frame (or the left end of a pan). `seconds` is how long the camera moves —
 * the speed caps scale with it.
 */
export function planShot(photo: PhotoForShot, format: VideoFormat, seconds: number): Shot {
  const { width: W, height: H } = photo;
  const a = format.width / format.height;
  const coverW = Math.min(W, H * a);
  const maxZoom = Math.min(format.maxZoom, (1 + SCALE_MAX_PER_S) ** seconds);
  // Never past the source's own pixels: on a small photo the tight frame stays
  // as wide as the output, or the cover frame if the photo is smaller still.
  const minW = Math.max(coverW / maxZoom, Math.min(coverW, format.width));
  const subject = subjectOf(photo);

  if (!subject) {
    const cover = frame(photo, a, coverW, W / 2, H / 2);
    const tight = frame(photo, a, Math.max(minW, coverW / Math.min(maxZoom, 1.12)), W / 2, H / 2);
    return { kind: "push", from: cover, to: tight };
  }

  const { box } = subject;
  if (box.w * TIGHT_MARGIN <= coverW) {
    // A subject taller than the crop (a standing couple in 16:9) keeps the
    // heads and loses the legs; one that already fills the crop still drifts.
    const needW = Math.max(box.w, box.h * a) * TIGHT_MARGIN;
    const tightW = Math.max(minW, Math.min(needW, coverW / MIN_ZOOM));
    const cx = box.x + box.w / 2;
    const cover = atEyeLine(photo, a, coverW, cx, subject, format.eyeLine);
    const tight = atEyeLine(photo, a, tightW, cx, subject, format.eyeLine);
    return { kind: "push", from: cover, to: tight };
  }

  // Wider than any crop of this shape: two people far apart in a landscape
  // photo cut to 9:16. Pan from one end to the other when that is a few
  // people and the pan stays slow enough; otherwise show the photo whole.
  const ends = [...subject.faces].sort((p, q) => p.x - q.x);
  const first = ends[0]!;
  const last = ends[ends.length - 1]!;
  if (subject.faces.length <= MAX_PANNED_FACES) {
    const one = (f: Face) => ({ ...subject, faces: [f], eyeY: ((f.le[1] + f.re[1]) / 2) * H });
    const from = atEyeLine(
      photo,
      a,
      coverW,
      (first.x + first.w / 2) * W,
      one(first),
      format.eyeLine,
    );
    const to = atEyeLine(photo, a, coverW, (last.x + last.w / 2) * W, one(last), format.eyeLine);
    const travel = Math.abs(to.x - from.x) / coverW;
    if (travel > 0 && travel <= PAN_MAX_PER_S * seconds) return { kind: "pan", from, to };
  }
  const whole = { x: 0, y: 0, w: W, h: H };
  return { kind: "fit", from: whole, to: whole };
}

/** A frame of aspect `a` and width `w`, centred on (cx, cy), inside the photo. */
function frame(photo: PhotoForShot, a: number, w: number, cx: number, cy: number): Rect {
  const h = w / a;
  return {
    x: clamp(cx - w / 2, 0, photo.width - w),
    y: clamp(cy - h / 2, 0, photo.height - h),
    w,
    h,
  };
}

/** A frame with the eyes on the format's eye line — unless that would cut off
 * the top of the subject's heads, which wins. */
function atEyeLine(
  photo: PhotoForShot,
  a: number,
  w: number,
  cx: number,
  subject: Subject,
  eyeLine: number,
): Rect {
  const h = w / a;
  let top = subject.eyeY - eyeLine * h;
  const headTop = Math.min(
    ...subject.faces.map((f) => headAndShoulders(f, photo.width, photo.height).y),
  );
  if (headTop < top) top = headTop;
  return frame(photo, a, w, cx, top + h / 2);
}

/**
 * Directions for a run of shots: push and pull alternate, groups and the
 * opening slide pull out. Pans alternate left and right. Fits are left as
 * they are.
 */
export function directShots(shots: readonly Shot[], faceCounts: readonly number[]): Shot[] {
  let zoomOut = false;
  let panLeft = false;
  return shots.map((shot, i) => {
    if (shot.kind === "fit") return shot;
    if (shot.kind === "pan") {
      panLeft = !panLeft;
      return panLeft ? shot : { ...shot, from: shot.to, to: shot.from };
    }
    zoomOut = i === 0 || (faceCounts[i] ?? 0) >= 3 ? true : !zoomOut;
    return zoomOut ? { kind: "pull", from: shot.to, to: shot.from } : shot;
  });
}

/** `e(t) = ½ − ½·cos(πt)`: starts and ends at rest. */
export function ease(t: number): number {
  return 0.5 - 0.5 * Math.cos(Math.PI * clamp(t, 0, 1));
}

/**
 * The camera at progress `t` (0–1): the centre moves linearly, the width
 * geometrically, so the zoom feels the same speed all the way.
 */
export function cameraAt(shot: Shot, t: number): Rect {
  const e = ease(t);
  const { from, to } = shot;
  const w = from.w * (to.w / from.w) ** e;
  const h = w * (from.h / from.w);
  const cx = from.x + from.w / 2 + (to.x + to.w / 2 - from.x - from.w / 2) * e;
  const cy = from.y + from.h / 2 + (to.y + to.h / 2 - from.y - from.h / 2) * e;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

/** Whether every framing face's eyes sit in the format's safe area of `rect`. */
export function eyesInSafeArea(photo: PhotoForShot, rect: Rect, format: VideoFormat): boolean {
  const subject = subjectOf(photo);
  if (!subject) return true;
  return subject.faces.every((f) =>
    [f.le, f.re].every(([ex, ey]) => {
      const x = (ex * photo.width - rect.x) / rect.w;
      const y = (ey * photo.height - rect.y) / rect.h;
      return (
        x >= format.safe.x0 && x <= format.safe.x1 && y >= format.safe.y0 && y <= format.safe.y1
      );
    }),
  );
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), Math.max(min, max));
}
