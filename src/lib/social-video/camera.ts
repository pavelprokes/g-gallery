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
  /** Every face found, aimed at or not — what a reel's frame keeps whole or
   * leaves out, never cuts through. `faces` when absent. */
  avoid?: readonly Face[];
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
  { reel }: { reel?: ReelLook } = {},
): Shot {
  const { width: W, height: H } = photo;
  const a = format.width / format.height;
  const coverW = Math.min(W, H * a);
  const maxZoom = Math.min(format.maxZoom, (1 + SCALE_MAX_PER_S) ** seconds);
  // Not much past the source's own pixels: the tight frame may enlarge it by
  // MAX_UPSCALE (Instagram's own re-encode hides that), no more. The fetch
  // sizes the source so the cover frame is at least the output (sourceWidth).
  const minW = Math.max(coverW / maxZoom, Math.min(coverW, format.width / MAX_UPSCALE));
  if (reel) return reelShot(photo, format, coverW, seconds, reel);
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

/** How a reel's photos are framed (docs/REELS.md §5), the photographer's choice. */
export interface ReelLook {
  /** A gentle push on the slides long enough to show it; otherwise every frame still. */
  zoom: boolean;
}

/** The most "Jemné přiblížení" goes past the cover frame… */
export const REEL_ZOOM = 1.15;
/** …and only on a slide this long: a push on a half-second cut only shakes. */
const REEL_ZOOM_SECONDS = 0.9;
/** Air around the heads when zooming (head and shoulders already in). */
const REEL_MARGIN = 1.3;
/** A face the frame must not cut through, even one too unsure to aim by: a
 * profile in a kiss scores lower than a face seen straight on. */
const AVOID_MIN_SCORE = 0.5;

/**
 * A reel's shot (docs/REELS.md §5). The cover frame — the most of the photo
 * the video's shape holds — placed on the faces, or the sharp part, or a
 * third down the middle; never closer unless the photographer asked for the
 * gentle zoom and the slide is long enough to show it. Wherever it lands, it
 * cuts no head it can see in half (`settle`): a subject wider than the crop
 * keeps the faces that fit whole (`facesInWindow`), and the frame is moved
 * off any other head rather than through it. Still by default.
 */
function reelShot(
  photo: PhotoForShot,
  format: VideoFormat,
  coverW: number,
  seconds: number,
  look: ReelLook,
): Shot {
  const { width: W, height: H } = photo;
  const a = format.width / format.height;
  let subject = subjectOf(photo);
  if (subject && subject.box.w > coverW) {
    const kept = facesInWindow(photo, coverW);
    if (kept.length > 0) subject = subjectOf({ ...photo, faces: kept });
  }
  const aim = subject;
  const heads = (photo.avoid ?? photo.faces)
    .filter((f) => f.score >= AVOID_MIN_SCORE)
    .map((f) => headAndShoulders(f, W, H));
  const keep = aim ? aim.faces.map((f) => headAndShoulders(f, W, H)) : [];

  const place = (w: number): Rect => {
    if (aim) return atEyeLine(photo, a, w, aim.box.x + aim.box.w / 2, aim, format.eyeLine);
    if (photo.focus) {
      const f = photo.focus;
      return frame(photo, a, w, (f.x + f.w / 2) * W, (f.y + f.h / 2) * H);
    }
    return frame(photo, a, w, W / 2, H * FACELESS_AIM);
  };
  const cover = settle(photo, place(coverW), heads, keep);
  if (!look.zoom || seconds < REEL_ZOOM_SECONDS) return { kind: "push", from: cover, to: cover };

  // Not past the fetched pixels (`sourceWidth` with REEL_ZOOM) by more than MAX_UPSCALE.
  const fetched = Math.min(1, (REEL_ZOOM * format.width) / coverW);
  const least = Math.min(
    coverW,
    Math.max(coverW / REEL_ZOOM, format.width / MAX_UPSCALE / fetched),
  );
  const need = aim
    ? Math.max(aim.box.w, aim.box.h * a) * REEL_MARGIN
    : photo.focus
      ? Math.max(photo.focus.w * W, photo.focus.h * H * a) * REEL_MARGIN
      : 0;
  const tight = settle(photo, place(Math.min(coverW, Math.max(least, need))), heads, keep);
  return { kind: "push", from: cover, to: tight };
}

/**
 * `rect` moved — as little as it takes — so that every head in `keep` is in
 * it whole and no other head is cut through by its edges: a head is either
 * in the frame or out of it. Along whichever axis the frame is shorter than
 * the photo (both, when zoomed); where no place does all that, the one
 * cutting the least head.
 */
function settle(
  photo: PhotoForShot,
  rect: Rect,
  heads: readonly Rect[],
  keep: readonly Rect[],
): Rect {
  const x = along(rect.x, rect.w, photo.width, heads.map(xSpan), keep.map(xSpan));
  const y = along(rect.y, rect.h, photo.height, heads.map(ySpan), keep.map(ySpan));
  return { ...rect, x, y };
}

const xSpan = (r: Rect): [number, number] => [r.x, r.x + r.w];
const ySpan = (r: Rect): [number, number] => [r.y, r.y + r.h];

/** One axis of `settle`: the frame's start, `size` long, in a photo `length` long. */
function along(
  pos: number,
  size: number,
  length: number,
  heads: readonly [number, number][],
  keep: readonly [number, number][],
): number {
  const limit = length - size;
  if (limit <= 0.5) return pos;
  const places = new Set([pos, 0, limit]);
  for (const [lo, hi] of heads)
    places
      .add(lo - size)
      .add(hi)
      .add(lo)
      .add(hi - size);
  let best = pos;
  let bestCost = Infinity;
  for (const raw of places) {
    const at = clamp(raw, 0, limit);
    let cost = 0;
    for (const [lo, hi] of heads) {
      const inside = Math.max(0, Math.min(hi, at + size) - Math.max(lo, at));
      // Partly in: one for the cut, and the share of the head it loses.
      if (inside > 0.5 && inside < hi - lo - 0.5) cost += 1 + (hi - lo - inside) / (hi - lo);
    }
    for (const [lo, hi] of keep) if (lo < at - 0.5 || hi > at + size + 0.5) cost += 10;
    // Among equals, the place nearest the one aimed at.
    const total = cost * 1e6 + Math.abs(at - pos);
    if (total < bestCost) {
      bestCost = total;
      best = at;
    }
  }
  return best;
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

/** How far a shot goes past its photo's cover frame at its tightest — what
 * the photo is fetched for (`sourceWidth`'s `zoom`). */
export function shotZoom(
  photo: { width: number; height: number },
  shot: Shot,
  format: VideoFormat,
): number {
  const coverW = Math.min(photo.width, (photo.height * format.width) / format.height);
  return Math.max(1, coverW / Math.min(shot.from.w, shot.to.w));
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
