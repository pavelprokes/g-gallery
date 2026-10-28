// The camera move of one slide (docs/SOCIAL-VIDEO.md §5): where it starts and
// ends in the photo, and where it is at any moment between. Pure and
// client-safe; every rectangle is in the photo's own pixels.

import type { Face } from "@/lib/social-video/faces";
import type { Focus } from "@/lib/social-video/focus";

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
 * largest face's area — a stranger far behind the couple does not. 0.7: on a
 * real wedding YuNet's real faces score 0.7–0.96, and the doubtful boxes that
 * pass its second look sit at 0.60–0.63 (docs/SOCIAL-VIDEO.md §7). */
export const FRAMING_MIN_SCORE = 0.7;

/** Without a face, the camera aims here, as a share of the photo's height:
 * at a wedding the heads are in the upper third far more often than in the
 * middle, and the middle of a full-length portrait cut to 16:9 is a waist. */
const FACELESS_AIM = 1 / 3;
const FRAMING_MIN_AREA = 0.15;

/** Head and shoulders around a face box, in face heights and widths. */
const HEADROOM = 0.8;
const BELOW_FACE = 1.0;
const BESIDE_FACE = 0.4;

/** Air around the subject in the tight frame. */
const TIGHT_MARGIN = 1.08;

/** How far the tight frame may enlarge the source's pixels. */
const MAX_UPSCALE = 1.35;

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
  /** The sharp part of the photo (focus.ts): the aim when no face frames it. */
  focus?: Focus | null;
}

interface Subject {
  box: Rect;
  eyeY: number;
  faces: Face[];
}

/** The faces the camera frames by: sure ones, not far smaller than the largest. */
export function framedFaces(faces: readonly Face[]): Face[] {
  const strong = faces.filter((f) => f.score >= FRAMING_MIN_SCORE);
  if (strong.length === 0) return [];
  const largest = Math.max(...strong.map((f) => f.w * f.h));
  return strong.filter((f) => f.w * f.h >= largest * FRAMING_MIN_AREA);
}

/** The faces that frame the photo, widened to head and shoulders, as one box. */
export function subjectOf(photo: PhotoForShot): Subject | null {
  const faces = framedFaces(photo.faces);
  if (faces.length === 0) return null;

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
export function planShot(
  photo: PhotoForShot,
  format: VideoFormat,
  seconds: number,
  { reel = false }: { reel?: boolean } = {},
): Shot {
  const { width: W, height: H } = photo;
  const a = format.width / format.height;
  const coverW = Math.min(W, H * a);
  const maxZoom = Math.min(format.maxZoom, (1 + SCALE_MAX_PER_S) ** seconds);
  // Not much past the source's own pixels: the tight frame may enlarge it by
  // MAX_UPSCALE (Instagram's own re-encode hides that), no more. The fetch
  // sizes the source so the cover frame is at least the output (sourceWidth).
  const minW = Math.max(coverW / maxZoom, Math.min(coverW, format.width / MAX_UPSCALE));
  if (reel) return reelShot(photo, format, coverW);
  const subject = subjectOf(photo);

  if (!subject && photo.focus) {
    // A detail shot wide open: frame the sharp part as a face would be framed,
    // with air around it, the push no stronger than for a face.
    const f = photo.focus;
    const cx = (f.x + f.w / 2) * W;
    const cy = (f.y + f.h / 2) * H;
    const needW = Math.max(f.w * W, f.h * H * a) * TIGHT_MARGIN;
    const tightW = Math.max(minW, Math.min(needW, coverW / MIN_ZOOM));
    return {
      kind: "push",
      from: frame(photo, a, coverW, cx, cy),
      to: frame(photo, a, tightW, cx, cy),
    };
  }

  if (!subject) {
    const cy = H * FACELESS_AIM;
    const cover = frame(photo, a, coverW, W / 2, cy);
    const tight = frame(photo, a, Math.max(minW, coverW / Math.min(maxZoom, 1.12)), W / 2, cy);
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

/** A reel's photo is on screen for half a second to a second: closer in than a
 * slideshow's, at most this far past the cover frame… */
export const REEL_ZOOM = 1.8;
/** …with this much air around the heads (head and shoulders already in). */
const REEL_MARGIN = 1.25;
/** The cut's own small push: a still frame on the beat reads as a freeze. */
const REEL_PUSH = 1.04;

/**
 * A reel's shot (docs/REELS.md §5): close on the faces — or, without a face
 * to frame, on the sharp part — as close as REEL_ZOOM and the photo's own
 * pixels allow, eyes on the eye line, no head cut: a subject wider than the
 * crop keeps the faces that fit whole (`facesInWindow`), never the photo
 * shown small over its blur. Then the slightest push, in or out.
 */
function reelShot(photo: PhotoForShot, format: VideoFormat, coverW: number): Shot {
  const { width: W, height: H } = photo;
  const a = format.width / format.height;
  // The source is fetched REEL_ZOOM times the cover's size where the photo has
  // the pixels (`sourceWidth`); a frame no smaller than MAX_UPSCALE of them.
  const fetched = Math.min(1, (REEL_ZOOM * format.width) / coverW);
  const minW = Math.min(coverW, Math.max(coverW / REEL_ZOOM, format.width / MAX_UPSCALE / fetched));
  const sized = (need: number) => Math.min(coverW, Math.max(minW, need));
  const push = (wide: Rect, tight: Rect): Shot => ({ kind: "push", from: wide, to: tight });

  let subject = subjectOf(photo);
  if (subject && subject.box.w * REEL_MARGIN > coverW) {
    const kept = facesInWindow(photo, coverW / REEL_MARGIN);
    if (kept.length > 0) subject = subjectOf({ ...photo, faces: kept });
  }
  if (subject) {
    const { box } = subject;
    const w = sized(Math.max(box.w, box.h * a) * REEL_MARGIN);
    const cx = box.x + box.w / 2;
    return push(
      atEyeLine(photo, a, w, cx, subject, format.eyeLine),
      atEyeLine(photo, a, Math.max(minW, w / REEL_PUSH), cx, subject, format.eyeLine),
    );
  }
  if (photo.focus) {
    const f = photo.focus;
    const cx = (f.x + f.w / 2) * W;
    const cy = (f.y + f.h / 2) * H;
    const w = sized(Math.max(f.w * W, f.h * H * a) * REEL_MARGIN);
    return push(frame(photo, a, w, cx, cy), frame(photo, a, Math.max(minW, w / REEL_PUSH), cx, cy));
  }
  // Nothing known to aim at: the cover frame, a third down the photo.
  const cy = H * FACELESS_AIM;
  return push(
    frame(photo, a, coverW, W / 2, cy),
    frame(photo, a, Math.max(minW, coverW / REEL_PUSH), W / 2, cy),
  );
}

/**
 * The faces a full-height crop `width` wide can hold whole: of every place to
 * put it — each framed head at either edge — the one keeping the most face
 * (by area: the nearer, larger faces first), with any head it would cut
 * through costing twice what it holds. Ties go to the window nearer the
 * photo's centre. Which faces count was settled before (`aimFaces`).
 */
function facesInWindow(photo: PhotoForShot, width: number): Face[] {
  const { width: W, height: H } = photo;
  const faces = framedFaces(photo.faces);
  const heads = faces.map((f) => headAndShoulders(f, W, H));
  const weight = (f: Face) => f.w * f.h;
  const places = new Set<number>([0, W - width]);
  for (const head of heads) {
    places.add(head.x);
    places.add(head.x + head.w - width);
  }
  let best: Face[] = [];
  let bestScore = -Infinity;
  let bestOff = Infinity;
  for (const raw of places) {
    const x = clamp(raw, 0, W - width);
    let score = 0;
    const kept: Face[] = [];
    heads.forEach((head, i) => {
      const left = Math.max(head.x, x);
      const right = Math.min(head.x + head.w, x + width);
      if (right <= left) return;
      if (left <= head.x + 0.5 && right >= head.x + head.w - 0.5) {
        score += weight(faces[i]!);
        kept.push(faces[i]!);
      } else {
        score -= 2 * weight(faces[i]!);
      }
    });
    const off = Math.abs(x + width / 2 - W / 2);
    if (score > bestScore + 1e-12 || (Math.abs(score - bestScore) <= 1e-12 && off < bestOff)) {
      best = kept;
      bestScore = score;
      bestOff = off;
    }
  }
  return best;
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

/** Widths the transform is asked for are rounded up to this, so renders of
 * the same photo share a cached variant (each one is billed once). */
const SOURCE_STEP = 256;

/**
 * The width to fetch a photo at so that its cover frame is at least the
 * output's size — never more than the photo itself.
 */
export function sourceWidth(
  photo: { width: number; height: number },
  format: VideoFormat,
  zoom = 1,
): number {
  const a = format.width / format.height;
  const coverW = Math.min(photo.width, photo.height * a);
  const scale = Math.min(1, (zoom * format.width) / coverW);
  return Math.min(photo.width, Math.ceil((photo.width * scale) / SOURCE_STEP) * SOURCE_STEP);
}
