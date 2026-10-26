// Face boxes for the social-video camera and the photo check
// (docs/SOCIAL-VIDEO.md §4): the stored shape of `Photo.faces`. The detector
// runs in a worker in the admin's browser (face-finder.ts, its pure half in
// yunet.ts).
//
// Detection, not recognition: a box, two eye points, a blink and a sharpness
// score per face. No embedding, nothing that could match a face across photos.

import { z } from "zod";

/** Bumped with any change to the model or the thresholds — a stored result
 * from another `model` is recomputed on demand, never mixed in. */
export const FACES_MODEL = "yunet-2026may@2048+check+eyes2@ort-web-1.30.0";

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
  /** Face Landmarker's eyeBlink of the more open eye — high only when both
   * are shut (src/lib/photo-check.ts); null where it was not looked at or
   * found no face. */
  blink: unit.nullable(),
  /** The eye region's sharpness (src/lib/photo-check.ts, `eyeSharpness`);
   * null where the eyes are too small or too dark to tell. Absent in values
   * written before it existed. */
  sharp: z.number().min(0).max(1000).nullable().optional(),
  /** Face Landmarker's mouthSmile, both sides averaged: eyes narrowed by a
   * laugh read as shut (src/lib/photo-check.ts). Null or absent where it was
   * not looked at. */
  smile: unit.nullable().optional(),
});

/** The sharp part of the photo (src/lib/social-video/focus.ts) — where the
 * camera aims when there is no face. */
const focusSchema = z.object({
  x: unit,
  y: unit,
  w: unit,
  h: unit,
  strength: z.number().min(0).max(10_000),
});

export const photoFacesSchema = z.object({
  v: z.literal(1),
  model: z.string().min(1).max(80),
  faces: z.array(faceSchema).max(MAX_FACES),
  /** Null: looked, nothing stands out. Absent: written before focus existed
   * (2026-10-26) — `needsFocus` sends such a faceless photo back to the worker
   * without a `FACES_MODEL` bump re-searching every photo of every gallery. */
  focus: focusSchema.nullable().optional(),
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

/** A faceless photo searched before focus existed: the camera has nothing to
 * aim by, so the face scan looks at it again. */
export function needsFocus(faces: PhotoFaces): boolean {
  return faces.faces.length === 0 && faces.focus === undefined;
}

/** The stored value from any detection build; null for none or anything that
 * does not parse. For what only needs a box — a box is a box, whichever build
 * found it (the projection, naming faces). */
export function storedFaces(stored: unknown): PhotoFaces | null {
  const parsed = photoFacesSchema.safeParse(stored);
  return parsed.success ? parsed.data : null;
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
