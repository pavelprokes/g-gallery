// Where a reel cuts (docs/REELS.md §3): one photo per cut, every cut on a
// beat, the video starting on the first beat of a bar and ending on one, the
// last photo held while the music fades. Pure: a `BeatAnalysis` in, a
// `Timeline` out — the same timeline the social video's `drawFrame` reads,
// with no fade, because a cut on the beat is the point.

import type { BeatAnalysis } from "@/lib/reels/beats";
import { followCuts } from "@/lib/reels/follow";
import { FPS, type Timeline } from "@/lib/social-video/timeline";

/** Roughly how long a photo stays, in seconds; the beat decides exactly.
 * "song" varies it with the music around a second (src/lib/reels/follow.ts). */
export const PACES = { song: 1, fast: 0.5, beat: 1, calm: 2 } as const;
export type Pace = keyof typeof PACES;

export const REEL_LENGTHS = [15, 20, 30] as const;
export type ReelLength = (typeof REEL_LENGTHS)[number];

/** Cuts land every this many beats — musical groupings only. */
const BEAT_GROUPS = [1, 2, 4, 8, 16] as const;
const BEATS_PER_BAR = 4;
/** A phrase is four bars; with accents its last cut is split in two. */
const PHRASE_BEATS = 16;
/** The last photo holds about a bar, within these bounds, while the music fades out. */
const HOLD = { min: 1.5, max: 2.5 };

/** The beat's length in seconds — the median gap, so one odd beat does not skew it. */
export function beatSeconds(analysis: BeatAnalysis): number {
  const gaps = analysis.beats.slice(1).map((t, i) => t - analysis.beats[i]!);
  if (gaps.length === 0) return 60 / analysis.bpm;
  const sorted = gaps.toSorted((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

/** The grouping of beats nearest the pace — 2 beats at 128 BPM is 0.94 s. */
export function beatsPerCut(beat: number, pace: Pace): number {
  const wanted = PACES[pace] / beat;
  return BEAT_GROUPS.reduce((best, n) =>
    Math.abs(Math.log(n / wanted)) < Math.abs(Math.log(best / wanted)) ? n : best,
  );
}

/** Beat indices that start a bar. */
export function barStarts(analysis: BeatAnalysis): number[] {
  const out: number[] = [];
  for (let i = analysis.downbeat; i < analysis.beats.length; i += BEATS_PER_BAR) out.push(i);
  return out.length > 0 ? out : [0];
}

/**
 * Up to `count` places to start the music, loudest stretch first: bar starts
 * whose next `seconds` are the loudest on average, at least half a reel
 * apart. A reel opens where the song is already going, not on its intro.
 */
export function sections(analysis: BeatAnalysis, seconds: number, count: number): number[] {
  const beat = beatSeconds(analysis);
  const span = Math.max(1, Math.round(seconds / beat));
  const starts = barStarts(analysis);
  const fitting = starts.filter((i) => i + span < analysis.beats.length);
  if (fitting.length === 0) return [starts[0]!];
  const mean = (i: number) => {
    let sum = 0;
    for (let k = i; k < i + span; k++) sum += analysis.energy[k] ?? 0;
    return sum / span;
  };
  const ranked = fitting
    .map((i) => ({ i, score: mean(i) }))
    .sort((a, b) => b.score - a.score || a.i - b.i);
  const picked: number[] = [];
  for (const { i } of ranked) {
    if (picked.length >= count) break;
    if (picked.every((p) => Math.abs(p - i) >= span / 2)) picked.push(i);
  }
  return picked;
}

/** The bar start `bars` bars from `startBeat`, kept inside the track. */
export function shiftSection(analysis: BeatAnalysis, startBeat: number, bars: number): number {
  const starts = barStarts(analysis);
  const at = Math.max(
    0,
    starts.findIndex((i) => i >= startBeat),
  );
  return starts[Math.min(starts.length - 1, Math.max(0, at + bars))]!;
}

/** The bar start nearest `seconds` into the track — where a click on the song lands. */
export function barAt(analysis: BeatAnalysis, seconds: number): number {
  const at = (i: number) => analysis.beats[i] ?? 0;
  return barStarts(analysis).reduce((best, i) =>
    Math.abs(at(i) - seconds) < Math.abs(at(best) - seconds) ? i : best,
  );
}

/**
 * The song's loudness in `columns` slices of its length, 0–1 — the shape the
 * section picker draws. A slice takes its loudest beat; one with no beat
 * (the silence before the first) stays 0.
 */
export function loudness(analysis: BeatAnalysis, columns: number): number[] {
  const out = Array.from({ length: columns }, () => 0);
  if (analysis.duration <= 0) return out;
  analysis.beats.forEach((t, i) => {
    const column = Math.min(columns - 1, Math.floor((t / analysis.duration) * columns));
    out[column] = Math.max(out[column]!, analysis.energy[i] ?? 0);
  });
  const peak = Math.max(...out);
  return peak > 0 ? out.map((v) => v / peak) : out;
}

export interface ReelPlanOptions {
  startBeat: number;
  seconds: number;
  pace: Pace;
  /** Split the last cut of every four-bar phrase in two — the music's fill. */
  accents: boolean;
  /** Photos there are to show: fewer slots than this, or slower cuts. */
  maxPhotos: number;
}

export interface ReelPlan {
  /** Where the music starts in the track, seconds. */
  offset: number;
  startBeat: number;
  endBeat: number;
  /** The usual beats per photo — the median when the cuts follow the song. */
  beatsPerCut: number;
  /** The cuts follow the song: their lengths vary with it. */
  adaptive: boolean;
  /** One slide per photo; `fade` 0. */
  timeline: Timeline;
  /** How long the music fades out at the end — the last photo's hold. */
  fadeOut: number;
}

const frameSnap = (t: number) => Math.round(t * FPS) / FPS;

export function planReel(analysis: BeatAnalysis, options: ReelPlanOptions): ReelPlan {
  const { beats } = analysis;
  const beat = beatSeconds(analysis);
  const hold = Math.min(HOLD.max, Math.max(HOLD.min, BEATS_PER_BAR * beat));
  const s = Math.min(options.startBeat, Math.max(0, beats.length - 1));
  // The video ends on a bar's first beat: the one that, with the hold, comes
  // nearest the length asked for.
  const ends: number[] = [];
  for (let e = s + BEATS_PER_BAR; e < beats.length; e += BEATS_PER_BAR) ends.push(e);
  const zero = beats[s] ?? 0;
  let end = ends.reduce(
    (best, e) =>
      Math.abs(beats[e]! - zero + hold - options.seconds) <
      Math.abs(beats[best]! - zero + hold - options.seconds)
        ? e
        : best,
    ends[0] ?? s,
  );

  const maxPhotos = Math.max(1, options.maxPhotos);
  if (options.pace === "song") {
    const followed = planFollowing(analysis, s, end, hold, maxPhotos, options.accents);
    if (followed) return followed;
  }
  let perCut = beatsPerCut(beat, options.pace);
  let cuts = cutBeats(s, end, perCut, options.accents);
  // Too few photos for the pace: cut less often; at the slowest, end sooner.
  while (cuts.length > maxPhotos && perCut < BEAT_GROUPS.at(-1)!) {
    perCut *= 2;
    cuts = cutBeats(s, end, perCut, options.accents);
  }
  while (cuts.length > maxPhotos && end - BEATS_PER_BAR > s) {
    end -= BEATS_PER_BAR;
    cuts = cutBeats(s, end, perCut, options.accents);
  }
  cuts = cuts.slice(0, maxPhotos);

  const starts = cuts.map((i) => frameSnap((beats[i] ?? zero) - zero));
  const duration = frameSnap(starts.at(-1)! + hold);
  const slides = starts.map((start, i) => {
    const slideEnd = starts[i + 1] ?? duration;
    return { start, end: slideEnd, moveEnd: slideEnd };
  });
  return {
    offset: zero,
    startBeat: s,
    endBeat: end,
    beatsPerCut: perCut,
    adaptive: false,
    timeline: { slides, duration, fade: 0 },
    fadeOut: hold,
  };
}

/**
 * Cuts on the song's hits, from the bar at `s` to the bar at `end`, no more
 * of them than there are photos. Null when it cannot be done — the even pace
 * takes over.
 */
function planFollowing(
  analysis: BeatAnalysis,
  s: number,
  end: number,
  hold: number,
  maxPhotos: number,
  faster: boolean,
): ReelPlan | null {
  const cuts = followCuts(analysis, { startBeat: s, endBeat: end, faster, photos: maxPhotos });
  if (!cuts || cuts.length > maxPhotos) return null;
  const zero = cuts[0]!;
  const starts = cuts.map((t) => frameSnap(t - zero));
  const duration = frameSnap(starts.at(-1)! + hold);
  const slides = starts.map((start, i) => {
    const slideEnd = starts[i + 1] ?? duration;
    return { start, end: slideEnd, moveEnd: slideEnd };
  });
  const beat = beatSeconds(analysis);
  const lengths = cuts.slice(1).map((t, i) => (t - cuts[i]!) / beat);
  return {
    offset: zero,
    startBeat: s,
    endBeat: end,
    beatsPerCut:
      lengths.length > 0 ? Math.round(lengths.toSorted((a, b) => a - b)[lengths.length >> 1]!) : 1,
    adaptive: true,
    timeline: { slides, duration, fade: 0 },
    fadeOut: hold,
  };
}

/** The beat each photo starts on, from `start` to `end` (the last photo's). */
function cutBeats(start: number, end: number, perCut: number, accents: boolean): number[] {
  const out: number[] = [];
  for (let i = start; i < end; i += perCut) {
    const phraseEnd = start + Math.ceil((i - start + 1) / PHRASE_BEATS) * PHRASE_BEATS;
    out.push(i);
    // The group closing a phrase is cut twice as fast.
    if (accents && perCut >= 2 && i + perCut === phraseEnd && phraseEnd <= end) {
      out.push(i + perCut / 2);
    }
  }
  out.push(end);
  return out;
}
