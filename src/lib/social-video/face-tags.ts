// Who is who on a gallery's faces (docs/SOCIAL-VIDEO.md §4, "Who is who"):
// names the photographer gives faces by hand, matched back to the detected
// boxes. Pure and client-safe.
//
// A tag keeps its own copy of the box it was given on, so it outlives the
// detection it was made on: a new model finds the same face a few pixels off,
// and the overlap finds the tag again. Nothing here looks at a face's pixels.

import { framedFaces } from "@/lib/social-video/camera";
import { iou, type Face } from "@/lib/social-video/faces";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A name as typed: "Nevěsta", "Babička Jana". */
export const MAX_PERSON_NAME = 60;

/** A tag names the detected face it overlaps this much. The same face found
 * again moves by a few pixels (an overlap of 0.8 and more); a neighbour cheek
 * to cheek overlaps far less than half. */
export const TAG_MATCH_IOU = 0.5;

/** Each face's tag, or null. The largest overlaps pair first, and a tag names
 * one face at most — two boxes over one head cannot both take it. */
export function matchTags<T extends Box>(faces: readonly Face[], tags: readonly T[]): (T | null)[] {
  const pairs: { face: number; tag: number; overlap: number }[] = [];
  faces.forEach((f, face) =>
    tags.forEach((t, tag) => {
      const overlap = iou(f, t);
      if (overlap >= TAG_MATCH_IOU) pairs.push({ face, tag, overlap });
    }),
  );
  pairs.sort((p, q) => q.overlap - p.overlap);
  const out: (T | null)[] = faces.map(() => null);
  const used = new Set<number>();
  for (const { face, tag } of pairs) {
    if (out[face] || used.has(tag)) continue;
    out[face] = tags[tag]!;
    used.add(tag);
  }
  return out;
}

/** The couple's faces among those the camera frames by, as named. */
export function coupleFaces(faces: readonly Face[], coupleTags: readonly Box[]): Face[] {
  if (coupleTags.length === 0) return [];
  const framed = framedFaces(faces);
  const matched = matchTags(framed, coupleTags);
  return framed.filter((_, i) => matched[i] !== null);
}

/**
 * The faces the camera should frame by: the couple's when the photographer
 * named them on this photo, otherwise all of them. In a group the camera then
 * lands on the couple instead of showing everyone whole.
 */
export function focusFaces(faces: readonly Face[], coupleTags: readonly Box[]): readonly Face[] {
  const couple = coupleFaces(faces, coupleTags);
  return couple.length > 0 ? couple : faces;
}

export interface TaggedBox extends Box {
  personId: string;
}

/** One face to name, as the photographer's list shows it. */
export interface FaceTile {
  photoId: string;
  face: Face;
  /** Whom it is named after, or null. */
  personId: string | null;
}

/**
 * The faces worth naming, photo by photo and left to right: the ones the
 * camera frames by (a guest far behind the couple is not), each with its name
 * if it has one.
 */
export function faceTiles(
  photos: readonly { id: string; faces: readonly Face[] | null; tags: readonly TaggedBox[] }[],
): FaceTile[] {
  return photos.flatMap((photo) => {
    if (!photo.faces) return [];
    const framed = framedFaces(photo.faces).sort((p, q) => p.x - q.x);
    const matched = matchTags(framed, photo.tags);
    return framed.map((face, i) => ({
      photoId: photo.id,
      face,
      personId: matched[i]?.personId ?? null,
    }));
  });
}

/** Shots of one series follow each other this closely — a burst, a pose
 * repeated, the vows. */
export const SERIES_GAP_MS = 30_000;

export interface SeriesPhoto {
  id: string;
  /** Capture time, epoch ms; null where it is not known — no series then. */
  takenAt: number | null;
  width: number;
  height: number;
  faces: readonly Face[] | null;
  tags: readonly TaggedBox[];
}

/**
 * The same face, by place, on the neighbouring shots of a series: from the
 * photo just named, step through the photos either side (in the gallery's
 * order) while each one was taken within `SERIES_GAP_MS` of the last, has the
 * same shape, and has an unnamed framed face where the previous one was. Only
 * where the box stood — a person who moved is not followed, and nothing looks
 * at the face itself. Photos where the person is already named are skipped.
 */
export function seriesMatches(
  photos: readonly SeriesPhoto[],
  photoId: string,
  box: Box,
  personId: string,
): { photoId: string; face: Face }[] {
  const start = photos.findIndex((p) => p.id === photoId);
  if (start < 0) return [];
  const out: { photoId: string; face: Face }[] = [];
  for (const step of [-1, 1]) {
    let prev = photos[start]!;
    let at: Box = box;
    for (let i = start + step; i >= 0 && i < photos.length; i += step) {
      const photo = photos[i]!;
      const sameShape = photo.width > photo.height === prev.width > prev.height;
      const close =
        photo.takenAt !== null &&
        prev.takenAt !== null &&
        Math.abs(photo.takenAt - prev.takenAt) <= SERIES_GAP_MS;
      if (!photo.faces || !sameShape || !close) break;
      if (photo.tags.some((t) => t.personId === personId)) break;
      const framed = framedFaces(photo.faces);
      const named = matchTags(framed, photo.tags);
      let best: Face | null = null;
      let bestOverlap = TAG_MATCH_IOU;
      for (const [j, face] of framed.entries()) {
        const overlap = iou(face, at);
        if (named[j] === null && overlap >= bestOverlap) {
          best = face;
          bestOverlap = overlap;
        }
      }
      if (!best) break;
      out.push({ photoId: photo.id, face: best });
      prev = photo;
      at = best;
    }
  }
  return out;
}
