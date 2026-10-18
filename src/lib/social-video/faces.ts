// Face boxes for the social-video camera (docs/SOCIAL-VIDEO.md §4): the stored
// shape of `Photo.faces`, and how a blink score joins a detected face. The
// detector runs in a worker in the admin's browser (face-finder.ts, its pure
// half in yunet.ts).
//
// Detection, not recognition: a box, two eye points and a blink score per face.
// No embedding, nothing that could match a face across photos.

import { z } from "zod";

/** Bumped with any change to the model or the thresholds — a stored result
 * from another `model` is recomputed on demand, never mixed in. */
export const FACES_MODEL = "yunet-2026may@2048+check@ort-web-1.30.0";

/** The most faces stored for a photo — the best-scored ones. A whole wedding
 * on the steps is ~80 (docs/SOCIAL-VIDEO.md §7); the cap keeps a bad run from
 * writing a large blob into a row (~100 bytes a face). */
export const MAX_FACES = 128;

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
  faces: z.array(faceSchema).max(MAX_FACES),
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

/**
 * Hands each face the blink score of the Face Landmarker face whose centre
 * falls inside it. The landmarker misses more faces than YuNet, so it only
 * annotates; a face it did not see keeps `blink: null`.
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
