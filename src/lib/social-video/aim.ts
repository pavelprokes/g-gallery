// What the camera aims at (docs/SOCIAL-VIDEO.md §5): the sharp part of the
// photo before the faces, unless a face is itself sharp — the rings held up to
// the lens win over the couple blurred behind them. Decided here, before `planShot`, so the
// studio, the gift, the suggestion, the public maker, the guests' projection
// and the admin's "Detaily" filter all draw the same line.

import { framedFaces } from "@/lib/social-video/camera";
import { focusFaces, type Box } from "@/lib/social-video/face-tags";
import type { Face, PhotoFaces } from "@/lib/social-video/faces";
import type { Focus } from "@/lib/social-video/focus";
import { SOFT_BELOW } from "@/lib/photo-check";

/** A face in the plane of focus: its eyes were measured, and came out sharp. */
function sharp(face: Face): boolean {
  return face.sharp !== undefined && face.sharp !== null && face.sharp >= SOFT_BELOW;
}

/**
 * Sharpness has priority over faces (Pavel, 2026-10-26): a sharp detail in the
 * foreground with a face detected behind it is a shot of the detail. Only a
 * face measured sharp — in the plane of focus — keeps the camera on the faces;
 * one too small, dark or soft to show sharp eyes does not.
 */
function noneSharp(framed: readonly Face[]): boolean {
  return !framed.some(sharp);
}

/** How much of the face box the focus box covers. */
function covered(face: Face, focus: Focus): number {
  const w = Math.min(face.x + face.w, focus.x + focus.w) - Math.max(face.x, focus.x);
  const h = Math.min(face.y + face.h, focus.y + focus.h) - Math.max(face.y, focus.y);
  return w > 0 && h > 0 ? (w * h) / (face.w * face.h) : 0;
}

/**
 * The faces the camera should frame by: `faces` as they are, or none when the
 * photo has a sharp part, it is not one of the faces, and no face it would
 * frame is itself sharp — then `planShot` aims at the focus instead.
 */
export function aimFaces(faces: readonly Face[], focus: Focus | null | undefined): readonly Face[] {
  if (!focus) return faces;
  const framed = framedFaces(faces);
  if (framed.length === 0) return faces;
  if (!noneSharp(framed)) return faces;
  // The sharp part is one of the faces after all — a soft measure, a sharp face.
  if (framed.some((face) => covered(face, focus) > 0.5)) return faces;
  return [];
}

/** A detail shot: the camera aims at its sharp part, not at a face — what the
 * admin's "Detaily" filter lists (docs/ADMIN-FILTERS.md). The couple's named
 * boxes narrow the faces first, as every camera path does. */
export function isDetailShot(stored: PhotoFaces, coupleTags: readonly Box[] = []): boolean {
  const aimed = aimFaces(focusFaces(stored.faces, coupleTags), stored.focus);
  return !!stored.focus && framedFaces(aimed).length === 0;
}

/** Searched before focus existed (2026-10-26) where focus could decide the
 * aim — no face to frame, or none measured sharp: the face scan looks again. */
export function needsFocus(stored: PhotoFaces): boolean {
  if (stored.focus !== undefined) return false;
  const framed = framedFaces(stored.faces);
  return framed.length === 0 || noneSharp(framed);
}

/** Faceless as the camera sees it: nothing it would frame by. */
export function faceless(stored: PhotoFaces): boolean {
  return framedFaces(stored.faces).length === 0;
}
