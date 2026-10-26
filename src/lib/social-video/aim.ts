// What the camera aims at (docs/SOCIAL-VIDEO.md §5): the faces, unless they
// are soft and something else is sharp — the rings held up to the lens with
// the couple blurred behind them. Decided here, before `planShot`, so the
// studio, the gift, the suggestion, the public maker, the guests' projection
// and the admin's "Detaily" filter all draw the same line.

import { framedFaces } from "@/lib/social-video/camera";
import type { Face, PhotoFaces } from "@/lib/social-video/faces";
import type { Focus } from "@/lib/social-video/focus";
import { SOFT_BELOW } from "@/lib/photo-check";

/** A face counts as soft only where its eyes were measured and came out soft —
 * eyes too small or too dark to tell keep the face (`Face.sharp` null). */
function soft(face: Face): boolean {
  return face.sharp !== undefined && face.sharp !== null && face.sharp < SOFT_BELOW;
}

/** How much of the face box the focus box covers. */
function covered(face: Face, focus: Focus): number {
  const w = Math.min(face.x + face.w, focus.x + focus.w) - Math.max(face.x, focus.x);
  const h = Math.min(face.y + face.h, focus.y + focus.h) - Math.max(face.y, focus.y);
  return w > 0 && h > 0 ? (w * h) / (face.w * face.h) : 0;
}

/**
 * The faces the camera should frame by: `faces` as they are, or none when every
 * face it would frame is soft and the sharp part of the photo lies elsewhere —
 * then `planShot` aims at the focus instead.
 */
export function aimFaces(faces: readonly Face[], focus: Focus | null | undefined): readonly Face[] {
  if (!focus) return faces;
  const framed = framedFaces(faces);
  if (framed.length === 0) return faces;
  if (!framed.every(soft)) return faces;
  // The sharp part is one of the faces after all — a soft measure, a sharp face.
  if (framed.some((face) => covered(face, focus) > 0.5)) return faces;
  return [];
}

/** A detail shot: the camera aims at its sharp part, not at a face — what the
 * admin's "Detaily" filter lists (docs/ADMIN-FILTERS.md). */
export function isDetailShot(stored: PhotoFaces): boolean {
  return !!stored.focus && framedFaces(aimFaces(stored.faces, stored.focus)).length === 0;
}

/** Searched before focus existed (2026-10-26) where focus would decide the
 * aim — no face to frame, or only soft ones: the face scan looks again. */
export function needsFocus(stored: PhotoFaces): boolean {
  if (stored.focus !== undefined) return false;
  const framed = framedFaces(stored.faces);
  return framed.length === 0 || framed.every(soft);
}
