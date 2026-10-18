// The photo check (docs/SOCIAL-VIDEO.md §4, "The photo check"): closed eyes
// and soft eyes on the faces that matter, for the photographer to look at
// before the couple does. Pure — the measuring runs in the face worker
// (src/lib/social-video/face-finder.ts), the deciding here, so both are
// unit-tested.
//
// It only flags. Whether closed eyes are a blink or a kiss, whether a soft face
// is a missed focus or the depth of field, is the photographer's call.

import { FRAMING_MIN_SCORE } from "@/lib/social-video/camera";
import type { Face } from "@/lib/social-video/faces";

/** A face is looked at from this share of the largest face's area — a guest
 * far behind the couple is not the photo's subject. Closed eyes count in the
 * whole group; softness only on the main faces, since a shallow depth of field
 * is meant to leave the second row soft. */
const CLOSED_FROM_SHARE = 0.25;
const SOFT_FROM_SHARE = 0.5;

/** Per photo, the most faces given the per-face look (blink, sharpness) —
 * the largest first; a group of 80 is not culled eye by eye. */
export const MAX_ANALYSED = 24;

/** Face Landmarker's eyeBlink of the more open eye. Both eyes must be shut:
 * a laugh squints one eye past 0.5 as often as not. */
export const CLOSED_FROM = 0.5;
/** Eyes this open are looking at the camera. */
const OPEN_BELOW = 0.3;

/**
 * Shut eyes are flagged only where they are a miss: a posed group — this many
 * faces read, nearly all of them open-eyed — with someone's eyes shut. Over a
 * whole wedding (§7, 547 photos) shut eyes everywhere else were a moment: a
 * bride reading her speech, a kiss, a laugh, a look down at the rings — and
 * the landmarker cannot tell a look down from a blink.
 */
const GROUP_FROM = 4;
const GROUP_OPEN_SHARE = 0.75;
/** A laugh narrows the eyes to shut: not a blink. */
const LAUGH_FROM = 0.6;

/** Eye-region sharpness below this reads as soft. Over a whole wedding (§7,
 * 547 photos) the frontal faces under 0.07 were out of focus or moving, those
 * above it sharp but for a few borderline ones. */
export const SOFT_BELOW = 0.07;
/** Eyes at least this far apart, as a share of the face's width, face the
 * camera. In a profile the eye region falls on an ear or the hair, and reads
 * soft however sharp the photo. */
const FRONTAL_FROM = 0.3;

/** Eyes closer than this (in the searched copy's pixels) are too small to
 * judge sharpness — the measure then says more about the JPEG than the lens. */
export const MIN_EYE_PX = 24;

/** The eye region is sampled to this width (nearest pixel, so the measure
 * compares like with like across face sizes). */
export const EYE_SAMPLE_WIDTH = 64;
const EYE_REGION = { w: 2, h: 0.9 };
export const EYE_SAMPLE_HEIGHT = Math.round((EYE_SAMPLE_WIDTH * EYE_REGION.h) / EYE_REGION.w);

/** How far from the crop's centre the landmarked face may sit, as a share of
 * the crop: the face fills ~55 % of it, so a neighbour's centre is further out. */
const CENTRE_TOLERANCE = 0.2;

/** Darker than this (mean grey, 0–255) the eyes cannot be judged: shadow, not focus. */
const MIN_BRIGHTNESS = 35;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The faces worth the per-face look, largest first. */
export function facesToAnalyse(faces: readonly Face[]): Face[] {
  const strong = faces.filter((f) => f.score >= FRAMING_MIN_SCORE);
  const largest = Math.max(0, ...strong.map(area));
  return strong
    .filter((f) => area(f) >= largest * CLOSED_FROM_SHARE)
    .sort((a, b) => area(b) - area(a))
    .slice(0, MAX_ANALYSED);
}

/** Around both eyes, in the image's pixels; null when the eyes are too small. */
export function eyeRegion(face: Face, width: number, height: number): Rect | null {
  const [lx, ly] = [face.le[0] * width, face.le[1] * height];
  const [rx, ry] = [face.re[0] * width, face.re[1] * height];
  const apart = Math.hypot(rx - lx, ry - ly);
  if (apart < MIN_EYE_PX) return null;
  const w = apart * EYE_REGION.w;
  const h = apart * EYE_REGION.h;
  const x = (lx + rx) / 2 - w / 2;
  const y = (ly + ry) / 2 - h / 2;
  // Cut by the frame, the black beyond it would read as a hard edge.
  if (x < 0 || y < 0 || x + w > width || y + h > height) return null;
  return { x, y, w, h };
}

/** Whether the landmarker's face (its points, 0–1 of the crop) is the one
 * the crop was cut around — centred in it, not a neighbour at its edge. */
export function centredInCrop(points: readonly { x: number; y: number }[]): boolean {
  if (points.length === 0) return false;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  return Math.abs(cx - 0.5) < CENTRE_TOLERANCE && Math.abs(cy - 0.5) < CENTRE_TOLERANCE;
}

/** A square around the face, for the landmarker: it wants the whole head. */
export function headRegion(face: Face, width: number, height: number): Rect {
  const side = Math.max(face.w * width, face.h * height) * 1.8;
  return {
    x: (face.x + face.w / 2) * width - side / 2,
    y: (face.y + face.h / 2) * height - side / 2,
    w: side,
    h: side,
  };
}

/**
 * How sharp the eye region is: the energy of its Laplacian over its contrast,
 * on `rgba` sampled to EYE_SAMPLE_WIDTH × EYE_SAMPLE_HEIGHT. Null when it is
 * too dark to tell.
 */
export function eyeSharpness(
  rgba: ArrayLike<number>,
  width: number,
  height: number,
): number | null {
  const grey = new Float32Array(width * height);
  let mean = 0;
  for (let i = 0; i < grey.length; i++) {
    grey[i] = 0.299 * rgba[i * 4]! + 0.587 * rgba[i * 4 + 1]! + 0.114 * rgba[i * 4 + 2]!;
    mean += grey[i]!;
  }
  mean /= grey.length;
  if (mean < MIN_BRIGHTNESS) return null;
  let variance = 0;
  for (const v of grey) variance += (v - mean) ** 2;
  variance /= grey.length;
  let energy = 0;
  let n = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const l = 4 * grey[i]! - grey[i - 1]! - grey[i + 1]! - grey[i - width]! - grey[i + width]!;
      energy += l * l;
      n += 1;
    }
  }
  // The +25 keeps a flat, low-contrast patch (skin) from dividing by ~0.
  return n > 0 ? energy / n / (variance + 25) : null;
}

export interface PhotoCheck {
  /** Faces with both eyes shut. */
  closed: Face[];
  /** Main faces whose eyes are soft. */
  soft: Face[];
}

/** What the check flags on one photo's stored faces; `width` × `height` is
 * the photo's shape, which a face's proportions are read against. */
export function checkPhoto(faces: readonly Face[], width: number, height: number): PhotoCheck {
  const looked = facesToAnalyse(faces);
  const largest = Math.max(0, ...looked.map(area));
  // A face the landmarker read: a face, not a painting or the back of a head.
  const read = looked.filter((f) => f.blink !== null);

  const posedGroup =
    read.length >= GROUP_FROM &&
    read.filter((f) => f.blink! < OPEN_BELOW).length >= read.length * GROUP_OPEN_SHARE;
  const closed = posedGroup
    ? read.filter((f) => f.blink! >= CLOSED_FROM && (f.smile ?? 0) < LAUGH_FROM)
    : [];

  const soft = read.filter(
    (f) =>
      area(f) >= largest * SOFT_FROM_SHARE &&
      frontality(f, width, height) >= FRONTAL_FROM &&
      f.sharp !== undefined &&
      f.sharp !== null &&
      f.sharp < SOFT_BELOW,
  );
  return { closed, soft };
}

/** The eyes' distance over the face's width, in the photo's pixels. */
function frontality(f: Face, width: number, height: number): number {
  const apart = Math.hypot((f.re[0] - f.le[0]) * width, (f.re[1] - f.le[1]) * height);
  return apart / (f.w * width);
}

function area(f: Face): number {
  return f.w * f.h;
}
