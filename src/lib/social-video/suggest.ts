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
import { aimFaces } from "@/lib/social-video/aim";
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
  /** How much the guests took to it — favourites, reactions, print copies and
   * unique viewers, weighted (`likedScore`); 0 or absent when nobody did. */
  liked?: number;
}

export interface SuggestOptions {
  /** Photos a previous suggestion already showed: "Jiný výběr" reaches past
   * them where the day offers anything else. Pinned photos stay regardless. */
  avoid?: ReadonlySet<string>;
}

/** A guest's heart says the most, a reaction or a print copy a little less, a
 * look the least — but many looks still add up. */
export function likedScore(signals: {
  favorites: number;
  reactions: number;
  printCopies: number;
  uniqueViewers: number;
}): number {
  return (
    signals.favorites * 3 + signals.reactions * 2 + signals.printCopies * 2 + signals.uniqueViewers
  );
}

/** At most this much from the guests — as much as the right shape, never more
 * than the couple: a loved photo of the wrong shape can still win, a liked
 * landscape photo does not push the couple's portrait out of a Reel. */
const LIKED_MAX_BONUS = 2;

/** Pushes an already-shown photo below the alternatives without ruling it out —
 * a small day may have nothing else to offer. */
const AVOID_PENALTY = 4;

/** Shut eyes (src/lib/photo-check.ts, `CLOSED_FROM`) spoil a group photo —
 * someone blinked. In a photo of one or two people they are as often the
 * moment itself (a kiss, a hug), so they count only from this many faces. */
const BLINK_MIN_FACES = 3;

/** A photo's people as the camera sees them: a weaker box does not frame the
 * shot (camera.ts), so here it does not count as someone either. Null when
 * faces are not known. */
function peopleIn(c: VideoCandidate): Face[] | null {
  // As the camera aims: soft faces behind a sharp detail are not the slide's people.
  if (!c.faces) return null;
  return aimFaces(c.faces.faces, c.faces.focus).filter((f) => f.score >= FRAMING_MIN_SCORE);
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
  { avoid = new Set() }: SuggestOptions = {},
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
  // What the guests loved joins the pool even when no mark of the
  // photographer's put it there — up to the count, the most loved first.
  const loved = candidates
    .filter((c) => c.own && !inPick.has(c.id) && (c.liked ?? 0) > 0)
    .sort((p, q) => q.liked! - p.liked! || compareTimeline(p, q))
    .slice(0, count);
  const inPool = new Set([...inPick, ...loved.map((c) => c.id)]);
  const others = candidates.filter((c) => c.own && !inPool.has(c.id)).sort(compareTimeline);
  // Asked for another selection, the pool reaches as far past the photos
  // already shown as it takes to replace them.
  const poolSize = count * 2 + avoid.size;
  const pool = [
    ...highlighted.map((p) => ({ ...p, picked: true })),
    ...loved.map((candidate) => ({ candidate, pinned: false, picked: false })),
    ...evenly(others, poolSize - highlighted.length - loved.length).map((candidate) => ({
      candidate,
      pinned: false,
      picked: false,
    })),
  ].sort((p, q) => compareTimeline(p.candidate, q.candidate));

  const fitness = new Map(pool.map(({ candidate }) => [candidate.id, fitFor(candidate, format)]));
  const likedBonus = likedBonusFor(candidates);
  const rank = (p: (typeof pool)[number]) =>
    fitness.get(p.candidate.id)! +
    (p.picked ? PICK_BONUS : 0) +
    likedBonus(p.candidate) -
    (avoid.has(p.candidate.id) ? AVOID_PENALTY : 0);
  const pinned = pool.filter((p) => p.pinned);
  const rest = acrossChapters(
    pool
      .map((p, order) => ({ ...p, order, part: partOf(p.candidate, chapterStarts) }))
      .filter((p) => !p.pinned)
      .sort((p, q) => rank(q) - rank(p) || p.order - q.order),
    Math.max(0, count - pinned.length),
  );
  const chosen = new Set([...pinned, ...rest].map((p) => p.candidate.id));
  const picked = pool.filter((p) => chosen.has(p.candidate.id)).map((p) => p.candidate);

  const strength = (c: VideoCandidate) =>
    (c.pin === true ? 1000 : 0) +
    (c.tagged ? 10 : 0) +
    (c.rating ?? 0) +
    fitness.get(c.id)! +
    likedBonus(c);
  // Ends first: moving them afterwards could line up a new run. The runs are
  // then broken only in the middle, so the ends stay.
  return breakFacelessRuns(
    withStrongEnds(picked, strength),
    pool.map((p) => p.candidate).filter((c) => !chosen.has(c.id)),
  ).map((c) => c.id);
}

/** 0 to LIKED_MAX_BONUS, against the gallery's most loved photo — so a week
 * after delivery a single heart does not count for as much as it will never
 * count for again. */
function likedBonusFor(candidates: readonly VideoCandidate[]): (c: VideoCandidate) => number {
  const most = Math.max(0, ...candidates.map((c) => c.liked ?? 0));
  if (most === 0) return () => 0;
  return (c) => (LIKED_MAX_BONUS * (c.liked ?? 0)) / most;
}

/** Which chapter a photo falls in: how many chapters start at or before it. */
function partOf(c: VideoCandidate, chapterStarts: readonly TimelinePosition[]): number {
  return chapterStarts.filter((start) => compareTimeline(start, c) <= 0).length;
}

/**
 * `n` of the ranked photos, taken round the chapters — the best of each in
 * turn, the chapter with the stronger best photo first — so a short video
 * still visits every part of the day it can. Without chapters, plain rank.
 */
function acrossChapters<T extends { part: number }>(ranked: readonly T[], n: number): T[] {
  const parts = new Map<number, T[]>();
  for (const item of ranked) parts.set(item.part, [...(parts.get(item.part) ?? []), item]);
  const queues = [...parts.values()];
  const out: T[] = [];
  while (out.length < n && queues.some((q) => q.length > 0)) {
    for (const queue of queues) {
      if (out.length >= n) break;
      const next = queue.shift();
      if (next) out.push(next);
    }
  }
  return out;
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
  if (people.length > 0 && coupleFaces(faces, coupleTags).length > 0) score += COUPLE_BONUS;
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
  const framing = {
    width: c.width,
    height: c.height,
    faces: aimFaces(focusFaces(faces, coupleTags), c.faces?.focus),
    focus: c.faces?.focus,
  };
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
