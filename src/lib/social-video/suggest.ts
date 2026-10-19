// The photos a social video proposes (docs/SOCIAL-VIDEO.md §3) — a starting
// point the photographer reorders and edits, never a verdict. Built on the
// highlights' pick, which already spreads the choice over the parts of the day
// and keeps one frame per burst.

import { compareTimeline, type TimelinePosition } from "@/lib/gallery-chapters";
import { CLOSED_FROM } from "@/lib/photo-check";
import { pickHighlights, type HighlightCandidate } from "@/lib/gallery-highlights";
import {
  eyesInSafeArea,
  FRAMING_MIN_SCORE,
  planShot,
  type VideoFormat,
} from "@/lib/social-video/camera";
import { coupleFaces, focusFaces, type Box } from "@/lib/social-video/face-tags";
import type { Face, PhotoFaces } from "@/lib/social-video/faces";
import { FADE_SECONDS, SLIDE_SECONDS } from "@/lib/social-video/timeline";

export interface VideoCandidate extends HighlightCandidate {
  width: number | null;
  height: number | null;
  /** Null until detected — such a photo is neither helped nor held back. */
  faces: PhotoFaces | null;
  /** The boxes the photographer named as the couple on this photo (§4, "Who
   * is who"); none when absent. */
  coupleTags?: readonly Box[];
}

/** Shut eyes (src/lib/photo-check.ts, `CLOSED_FROM`) spoil a group photo —
 * someone blinked. In a photo of one or two people they are as often the
 * moment itself (a kiss, a hug), so they count only from this many faces. */
const BLINK_MIN_FACES = 3;

/** A photo's people as the camera sees them: a weaker box does not frame the
 * shot (camera.ts), so here it does not count as someone either. Null when
 * faces are not known. */
function peopleIn(c: VideoCandidate): Face[] | null {
  return c.faces?.faces.filter((f) => f.score >= FRAMING_MIN_SCORE) ?? null;
}

/** The couple named on a photo: it is their video. As much as the right
 * shape for the format, so a landscape photo of them still beats a portrait
 * of a guest. */
const COUPLE_BONUS = 2;

/** A photo from the highlights' pick outranks a top-up photo that fits as
 * well, or one step better — the pick is what the photographer marked and the
 * day's spread; the top-up only fills the gap. */
const PICK_BONUS = 1;

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
  const highlighted = pickHighlights(candidates, chapterStarts, count * 2, {
    maxPinned: count,
    minPhotosForAuto: 0,
  }).map(({ id, pinned }) => ({ candidate: byId.get(id)!, pinned }));
  // The pick keeps one frame per burst; a gallery of a few bursts (or photos
  // without a capture time, uploaded seconds apart) would leave the pool
  // short. Top it up from the rest of the day, evenly, to the same twice the
  // count — so the fit to the format still has a choice to make.
  const inPick = new Set(highlighted.map((p) => p.candidate.id));
  const others = candidates.filter((c) => c.own && !inPick.has(c.id)).sort(compareTimeline);
  const pool = [
    ...highlighted.map((p) => ({ ...p, picked: true })),
    ...evenly(others, count * 2 - highlighted.length).map((candidate) => ({
      candidate,
      pinned: false,
      picked: false,
    })),
  ].sort((p, q) => compareTimeline(p.candidate, q.candidate));

  const fitness = new Map(pool.map(({ candidate }) => [candidate.id, fitFor(candidate, format)]));
  const rank = (p: (typeof pool)[number]) =>
    fitness.get(p.candidate.id)! + (p.picked ? PICK_BONUS : 0);
  const pinned = pool.filter((p) => p.pinned);
  const rest = pool
    .map((p, order) => ({ ...p, order }))
    .filter((p) => !p.pinned)
    .sort((p, q) => rank(q) - rank(p) || p.order - q.order)
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
  const people = peopleIn(c);
  if (!faces || !people || c.width === null || c.height === null) return score;
  if (people.length > 0) score += 1;
  const coupleTags = c.coupleTags ?? [];
  if (coupleFaces(faces, coupleTags).length > 0) score += COUPLE_BONUS;
  // Known to show no face: for 9:16 a landscape photo is then cut blind — a
  // wide church or a beach with the couple somewhere off the crop.
  else if (wantsPortrait && !portrait) score -= 2;
  if (
    people.length >= BLINK_MIN_FACES &&
    people.some((f) => f.blink !== null && f.blink >= CLOSED_FROM)
  ) {
    score -= 5;
  }
  // Framed as the video will frame it: on the couple, where they are named.
  const framing = { width: c.width, height: c.height, faces: focusFaces(faces, coupleTags) };
  const shot = planShot(framing, format, SLIDE_SECONDS + FADE_SECONDS);
  // A wide group cut to 9:16 can only be shown whole, over its own blur — the
  // suggestion steers away from it; the photographer can still add it.
  if (shot.kind === "fit") score -= 3;
  // A face at the photo's very edge cannot be brought to the eye line.
  else if (!eyesInSafeArea(framing, shot.to, format)) score -= 1;
  return score;
}

/** Not three photos without people in a row: the middle one gives way to the
 * unused photo with faces closest to it in the day, if there is one. The first
 * and last slides are never the middle of a run, so they stay. */
function breakFacelessRuns(picked: VideoCandidate[], unused: VideoCandidate[]): VideoCandidate[] {
  const out = [...picked];
  const spare = unused.filter((c) => (peopleIn(c)?.length ?? 0) > 0);
  const faceless = (c: VideoCandidate) => peopleIn(c)?.length === 0;
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

/** `n` of `items`, evenly spaced from the first to the last. */
function evenly<T>(items: readonly T[], n: number): T[] {
  if (n <= 0) return [];
  if (items.length <= n) return [...items];
  if (n === 1) return [items[Math.floor(items.length / 2)]!];
  return Array.from(
    { length: n },
    (_, i) => items[Math.round((i * (items.length - 1)) / (n - 1))]!,
  );
}
