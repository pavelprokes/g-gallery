// The photos a social video proposes (docs/SOCIAL-VIDEO.md §3) — a starting
// point the photographer reorders and edits, never a verdict. Built on the
// highlights' pick, which already spreads the choice over the parts of the day
// and keeps one frame per burst.

import type { TimelinePosition } from "@/lib/gallery-chapters";
import { pickHighlights, type HighlightCandidate } from "@/lib/gallery-highlights";
import { eyesInSafeArea, planShot, type VideoFormat } from "@/lib/social-video/camera";
import type { PhotoFaces } from "@/lib/social-video/faces";
import { FADE_SECONDS, SLIDE_SECONDS } from "@/lib/social-video/timeline";

export interface VideoCandidate extends HighlightCandidate {
  width: number | null;
  height: number | null;
  /** Null until detected — such a photo is neither helped nor held back. */
  faces: PhotoFaces | null;
}

/** An eye this closed spoils a photo that would otherwise be picked. */
const BLINK_LIMIT = 0.5;

/**
 * `count` photo ids: pinned photos always, then the best fit of a pool twice
 * that size; the strongest two open and close it, the rest in the day's order.
 */
export function suggestPhotos(
  candidates: readonly VideoCandidate[],
  chapterStarts: readonly TimelinePosition[],
  format: VideoFormat,
  count: number,
): string[] {
  const byId = new Map(candidates.map((c) => [c.id, c]));
  // Any gallery gets a proposal — a small one simply all of its photos. (The
  // highlights hold back below 40 photos; a video of five is still a video.)
  const pool = pickHighlights(candidates, chapterStarts, count * 2, {
    maxPinned: count,
    minPhotosForAuto: 0,
  }).map(({ id, pinned }) => ({ candidate: byId.get(id)!, pinned }));

  const fitness = new Map(pool.map(({ candidate }) => [candidate.id, fitFor(candidate, format)]));
  const pinned = pool.filter((p) => p.pinned);
  const rest = pool
    .map((p, order) => ({ ...p, order }))
    .filter((p) => !p.pinned)
    .sort(
      (p, q) => fitness.get(q.candidate.id)! - fitness.get(p.candidate.id)! || p.order - q.order,
    )
    .slice(0, Math.max(0, count - pinned.length));
  const chosen = new Set([...pinned, ...rest].map((p) => p.candidate.id));
  const picked = pool.filter((p) => chosen.has(p.candidate.id)).map((p) => p.candidate);

  const strength = (c: VideoCandidate) =>
    (c.pin === true ? 1000 : 0) + (c.tagged ? 10 : 0) + (c.rating ?? 0) + fitness.get(c.id)!;
  // Ends first: moving them afterwards could line up a new run. The runs are
  // then broken only in the middle, so the ends stay.
  return breakFacelessRuns(
    withStrongEnds(picked, strength),
    pool.map((p) => p.candidate).filter((c) => !chosen.has(c.id)),
  ).map((c) => c.id);
}

/** How well a photo suits the format, from its shape and — when known — its faces. */
export function fitFor(c: VideoCandidate, format: VideoFormat): number {
  let score = 0;
  const portrait = c.width !== null && c.height !== null && c.height > c.width;
  const wantsPortrait = format.height > format.width;
  if (c.width !== null && c.height !== null && portrait === wantsPortrait) score += 2;

  const faces = c.faces?.faces;
  if (!faces || c.width === null || c.height === null) return score;
  if (faces.length > 0) score += 1;
  if (faces.some((f) => f.blink !== null && f.blink > BLINK_LIMIT)) score -= 5;
  const shot = planShot(
    { width: c.width, height: c.height, faces },
    format,
    SLIDE_SECONDS + FADE_SECONDS,
  );
  // A wide group cut to 9:16 can only be shown whole, over its own blur — the
  // suggestion steers away from it; the photographer can still add it.
  if (shot.kind === "fit") score -= 3;
  // A face at the photo's very edge cannot be brought to the eye line.
  else if (!eyesInSafeArea({ width: c.width, height: c.height, faces }, shot.to, format))
    score -= 1;
  return score;
}

/** Not three photos without people in a row: the middle one gives way to the
 * unused photo with faces closest to it in the day, if there is one. The first
 * and last slides are never the middle of a run, so they stay. */
function breakFacelessRuns(picked: VideoCandidate[], unused: VideoCandidate[]): VideoCandidate[] {
  const out = [...picked];
  const spare = unused.filter((c) => (c.faces?.faces.length ?? 0) > 0);
  const faceless = (c: VideoCandidate) => c.faces !== null && c.faces.faces.length === 0;
  for (let i = 1; i + 1 < out.length && spare.length > 0; i++) {
    if (!(faceless(out[i - 1]!) && faceless(out[i]!) && faceless(out[i + 1]!))) continue;
    const at = Date.parse(out[i]!.takenAt);
    spare.sort(
      (p, q) => Math.abs(Date.parse(p.takenAt) - at) - Math.abs(Date.parse(q.takenAt) - at),
    );
    out[i] = spare.shift()!;
  }
  return out;
}

/** The strongest photo opens, the next strongest closes; ties keep the day's order. */
function withStrongEnds(
  picked: VideoCandidate[],
  strength: (c: VideoCandidate) => number,
): VideoCandidate[] {
  if (picked.length < 3) return picked;
  const ranked = picked
    .map((c, i) => ({ c, i }))
    .sort((p, q) => strength(q.c) - strength(p.c) || p.i - q.i);
  const first = ranked[0]!.c;
  const last = ranked[1]!.c;
  return [first, ...picked.filter((c) => c !== first && c !== last), last];
}
