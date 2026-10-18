// Face boxes for the social-video camera (docs/SOCIAL-VIDEO.md §4): the stored
// shape of `Photo.faces`, and the pure half of detection — where the tiles go
// and how their detections merge. The detector itself runs in the admin's
// browser; nothing here touches MediaPipe.
//
// Detection, not recognition: a box, two eye points and a blink score per face.
// No embedding, nothing that could match a face across photos.

import { z } from "zod";

/** Bumped with any change to the model, the tiles or the thresholds — a stored
 * result from another `model` is recomputed on demand, never mixed in. */
export const FACES_MODEL = "blazeface-sr+tiles2-5@tasks-vision-1.1.1";

/** Whole-frame detections below this are dropped. */
export const FRAME_MIN_SCORE = 0.5;

/** A tile shows skin without the context around it; below this, shoulders and
 * knees read as faces (the spike, docs/SOCIAL-VIDEO.md §7). */
export const TILE_MIN_SCORE = 0.75;

/** Two boxes overlapping more than this are the same face. */
const NMS_IOU = 0.3;

/** Neighbouring tiles share this much of a tile's width, so a face on a seam
 * is whole in at least one of them. */
const TILE_OVERLAP = 0.3;

const unit = z.number().min(0).max(1);
const point = z.tuple([unit, unit]);

const faceSchema = z.object({
  x: unit,
  y: unit,
  w: unit,
  h: unit,
  score: unit,
  /** Eye centres, the left and the right one as seen in the photo. */
  le: point,
  re: point,
  /** Face Landmarker's eyeBlink, the higher eye; null where it found no face. */
  blink: unit.nullable(),
});

export const photoFacesSchema = z.object({
  v: z.literal(1),
  model: z.string().min(1).max(80),
  // A dance floor holds a few dozen at most; the cap keeps a bad run from
  // writing a large blob into a row.
  faces: z.array(faceSchema).max(64),
});

/** Coordinates are 0–1 of the oriented photo, origin top left. */
export type Face = z.infer<typeof faceSchema>;
export type PhotoFaces = z.infer<typeof photoFacesSchema>;

/** The stored value when it is usable by this build; null for none, an old
 * model, or anything that does not parse. */
export function currentFaces(stored: unknown): PhotoFaces | null {
  const parsed = photoFacesSchema.safeParse(stored);
  return parsed.success && parsed.data.model === FACES_MODEL ? parsed.data : null;
}

/** One pass of the detector: a window of the photo in its pixels, and the
 * score a detection in it must reach. */
export interface Tile {
  x: number;
  y: number;
  w: number;
  h: number;
  minScore: number;
}

/** The tile grids after the whole frame. 4×4 and 5×5 were added after a real
 * wedding (docs/SOCIAL-VIDEO.md §7): full-length shots of the couple put
 * faces at 3–5 % of the photo's height, which even a 3×3 tile misses. */
const TILE_GRIDS = [2, 3, 4, 5];

/**
 * The whole frame, then overlapping tiles from 2×2 to 5×5: the short-range
 * model finds nothing under ~12 % of the frame's height, and in a tile every
 * face is two to five times larger.
 */
export function tilesFor(width: number, height: number): Tile[] {
  const tiles: Tile[] = [{ x: 0, y: 0, w: width, h: height, minScore: FRAME_MIN_SCORE }];
  for (const n of TILE_GRIDS) {
    const w = Math.min(width, (width / n) * (1 + TILE_OVERLAP));
    const h = Math.min(height, (height / n) * (1 + TILE_OVERLAP));
    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++) {
        tiles.push({
          x: (col * (width - w)) / (n - 1),
          y: (row * (height - h)) / (n - 1),
          w,
          h,
          minScore: TILE_MIN_SCORE,
        });
      }
    }
  }
  return tiles;
}

/** A detection as MediaPipe reports it for one tile: the box in the tile's
 * pixels, the first two keypoints (the eyes) normalised to the tile. */
export interface TileDetection {
  box: { x: number; y: number; w: number; h: number };
  score: number;
  eyes: readonly [{ x: number; y: number }, { x: number; y: number }];
}

/**
 * Every tile's detections, mapped into the photo and merged: the best-scored
 * box of each overlapping cluster survives (non-max suppression).
 */
export function mergeDetections(
  width: number,
  height: number,
  passes: readonly { tile: Tile; detections: readonly TileDetection[] }[],
): Face[] {
  const all: Face[] = [];
  for (const { tile, detections } of passes) {
    for (const d of detections) {
      if (d.score < tile.minScore) continue;
      const eye = (p: { x: number; y: number }): [number, number] => [
        clamp01((tile.x + p.x * tile.w) / width),
        clamp01((tile.y + p.y * tile.h) / height),
      ];
      const [a, b] = [eye(d.eyes[0]), eye(d.eyes[1])];
      const x = clamp01((tile.x + d.box.x) / width);
      const y = clamp01((tile.y + d.box.y) / height);
      all.push({
        x,
        y,
        w: Math.min(1 - x, d.box.w / width),
        h: Math.min(1 - y, d.box.h / height),
        score: clamp01(d.score),
        le: a[0] <= b[0] ? a : b,
        re: a[0] <= b[0] ? b : a,
        blink: null,
      });
    }
  }
  all.sort((p, q) => q.score - p.score);
  const kept: Face[] = [];
  for (const face of all) if (kept.every((k) => iou(k, face) < NMS_IOU)) kept.push(face);
  return kept;
}

/**
 * Hands each face the blink score of the Face Landmarker face whose centre
 * falls inside it. The landmarker misses more faces than the tiled detector,
 * so it only annotates; a face it did not see keeps `blink: null`.
 */
export function attachBlinks(
  faces: readonly Face[],
  landmarked: readonly { x: number; y: number; w: number; h: number; blink: number }[],
): Face[] {
  return faces.map((face) => {
    const match = landmarked.find((l) => {
      const cx = l.x + l.w / 2;
      const cy = l.y + l.h / 2;
      return cx >= face.x && cx <= face.x + face.w && cy >= face.y && cy <= face.y + face.h;
    });
    return match ? { ...face, blink: clamp01(match.blink) } : face;
  });
}

export function iou(
  p: { x: number; y: number; w: number; h: number },
  q: { x: number; y: number; w: number; h: number },
): number {
  const ix = Math.max(0, Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x));
  const iy = Math.max(0, Math.min(p.y + p.h, q.y + q.h) - Math.max(p.y, q.y));
  const inter = ix * iy;
  const union = p.w * p.h + q.w * q.h - inter;
  return union > 0 ? inter / union : 0;
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}
