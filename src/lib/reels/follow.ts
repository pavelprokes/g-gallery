// Cuts that follow the song (docs/REELS.md §3, "Podle písničky"): where the
// music is busy the photos change on every beat — on the off-beat too, when
// something is hit there — where it is sparse they hold for a bar, a change
// of section gets a cut of its own, and every cut lands where a hit is. The
// same kind of dynamic programme the beats are found with (Ellis 2007), one
// level up: from the reel's first beat to its last, the chain of cuts that
// sits on the hardest hits while keeping each photo near the length the
// music around it asks for. Pure: a `BeatAnalysis` in, cut positions out.

import type { BeatAnalysis } from "@/lib/reels/beats";

/** Cut positions are in beats: 12 is the 13th beat, 12.5 the off-beat after it. */
export type CutPosition = number;

const BEATS_PER_BAR = 4;
/** How hard a photo's length is held to its target — per octave off, squared. */
const LENGTH_WEIGHT = 2.5;
/** No photo shorter than this, whatever the tempo: below it a face cannot be read. */
const MIN_SECONDS = 0.3;
/** An off-beat is a place to cut only where it is hit this hard. */
const OFFBEAT_FLOOR = 0.3;
/** Musical lengths (beats) cost nothing; the rest cost this — a hit can pay it. */
const ODD_LENGTH = 0.45;
const MUSICAL_LENGTHS = new Set([0.5, 1, 2, 4, 8]);
/** Bonuses for where a cut falls. */
const BAR_START = 0.3;
const HALF_BAR = 0.12;
const CHANGE = 1.2;
const HIT = 2.5;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

function quantile(values: readonly number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
}

/**
 * How intense the music is at each beat, 0–1 against the song itself: its
 * busyness (onsets) counts more than its loudness, since a mastered song is
 * loud nearly throughout. A song that hardly changes stays at 0.5 — its cuts
 * keep an even pace.
 */
export function intensity(analysis: BeatAnalysis): number[] {
  const busiest = Math.max(0.05, quantile(analysis.density, 0.9));
  const raw = analysis.beats.map(
    (_, i) =>
      0.35 * (analysis.energy[i] ?? 0) + 0.65 * Math.min(1, (analysis.density[i] ?? 0) / busiest),
  );
  // Bar by bar, so one loud beat is not a section and a section turns on its
  // first beat rather than fading in over the beats around it.
  const barOf = (i: number) => Math.floor((i - analysis.downbeat) / BEATS_PER_BAR);
  const sums = new Map<number, { sum: number; n: number }>();
  raw.forEach((v, i) => {
    const bar = sums.get(barOf(i)) ?? { sum: 0, n: 0 };
    sums.set(barOf(i), { sum: bar.sum + v, n: bar.n + 1 });
  });
  const smooth = raw.map((_, i) => {
    const bar = sums.get(barOf(i))!;
    return bar.sum / bar.n;
  });
  const lo = quantile(smooth, 0.1);
  const hi = quantile(smooth, 0.9);
  if (hi - lo < 0.15) return smooth.map(() => 0.5);
  return smooth.map((v) => clamp01((v - lo) / (hi - lo)));
}

/**
 * Bar starts where the song turns into something else — a verse into a
 * chorus, a break, a drop: the bars after differ most from the bars before
 * in loudness and busyness (Foote's novelty, on two bars either side).
 */
export function changes(analysis: BeatAnalysis): Set<number> {
  const level = intensity(analysis);
  const bars: number[] = [];
  for (let i = analysis.downbeat; i < analysis.beats.length; i += BEATS_PER_BAR) bars.push(i);
  const barLevel = bars.map((b) => {
    let sum = 0;
    let n = 0;
    for (let k = b; k < b + BEATS_PER_BAR && k < level.length; k++) {
      sum += level[k]!;
      n += 1;
    }
    return n > 0 ? sum / n : 0;
  });
  const mean = (from: number, to: number) => {
    const slice = barLevel.slice(Math.max(0, from), Math.min(barLevel.length, to));
    return slice.length > 0 ? slice.reduce((a, b) => a + b, 0) / slice.length : 0;
  };
  const novelty = bars.map((_, j) => (j < 1 ? 0 : Math.abs(mean(j, j + 2) - mean(j - 2, j))));
  const out = new Set<number>();
  novelty.forEach((v, j) => {
    const peak = v >= (novelty[j - 1] ?? 0) && v >= (novelty[j + 1] ?? 0);
    if (v >= 0.25 && peak) out.add(bars[j]!);
  });
  return out;
}

/** Beats hit far harder than the bar around them — a stab, a drop, the hit after a break. */
function hits(analysis: BeatAnalysis): Set<number> {
  const out = new Set<number>();
  analysis.strength.forEach((s, i) => {
    let sum = 0;
    let n = 0;
    for (let k = i - 4; k <= i + 4; k++) {
      if (k !== i && k >= 0 && k < analysis.strength.length) {
        sum += analysis.strength[k]!;
        n += 1;
      }
    }
    if (s >= 0.5 && s >= 2.5 * (n > 0 ? sum / n : 0)) out.add(i);
  });
  return out;
}

/** Seconds into the track of a cut position — an off-beat is halfway between its beats. */
export function positionTime(analysis: BeatAnalysis, p: CutPosition): number {
  const { beats } = analysis;
  const i = Math.floor(p);
  const at = beats[i] ?? beats.at(-1) ?? 0;
  if (p === i) return at;
  const next = beats[i + 1] ?? at + (at - (beats[i - 1] ?? at - 0.5));
  return (at + next) / 2;
}

export interface FollowOptions {
  startBeat: number;
  endBeat: number;
  /** The usual photo length, seconds — what a moderately busy stretch gets. */
  base: number;
  /** Shorter photos throughout (the "Se zrychlením" variant). */
  faster: boolean;
}

/**
 * The cut positions from `startBeat` to `endBeat`, both included — the last
 * is where the final photo starts and holds. Null when no chain fits (a reel
 * too short for even one cut).
 */
export function followCuts(analysis: BeatAnalysis, options: FollowOptions): CutPosition[] | null {
  const { startBeat, endBeat } = options;
  if (endBeat <= startBeat || endBeat >= analysis.beats.length) return null;
  const level = intensity(analysis);
  const turns = changes(analysis);
  const stabs = hits(analysis);
  const timeOf = (p: CutPosition) => positionTime(analysis, p);
  const base = options.base * (options.faster ? 0.7 : 1);
  const target = (p: CutPosition, q: CutPosition) => {
    // The music the photo plays over: the mean intensity of its beats.
    let sum = 0;
    let n = 0;
    for (let k = Math.floor(p); k < Math.ceil(q); k++) {
      sum += level[k] ?? 0.5;
      n += 1;
    }
    const at = n > 0 ? sum / n : 0.5;
    // Busiest: half the usual length (a beat at 100–130 BPM); sparsest: about
    // half as long again — a reel's verse still moves.
    return base * 2 ** (0.5 - 1.5 * at);
  };
  const longest = Math.min(3.2, options.base * 2.2);

  // The places a cut can go: every beat, and the off-beats something is hit on.
  const positions: CutPosition[] = [];
  for (let i = startBeat; i <= endBeat; i++) {
    positions.push(i);
    if (i < endBeat && (analysis.offbeat[i] ?? 0) >= OFFBEAT_FLOOR) positions.push(i + 0.5);
  }
  const worth = (p: CutPosition) => {
    if (p === startBeat || p === endBeat) return 0;
    const i = Math.floor(p);
    if (p !== i) return 0.9 * (analysis.offbeat[i] ?? 0);
    const inBar = (((i - analysis.downbeat) % BEATS_PER_BAR) + BEATS_PER_BAR) % BEATS_PER_BAR;
    return (
      (analysis.strength[i] ?? 0) +
      (inBar === 0 ? BAR_START : inBar === 2 ? HALF_BAR : 0) +
      (turns.has(i) ? CHANGE : 0) +
      (stabs.has(i) ? HIT : 0)
    );
  };

  const score = new Float64Array(positions.length).fill(-Infinity);
  const back = new Int32Array(positions.length).fill(-1);
  score[0] = 0;
  for (let q = 1; q < positions.length; q++) {
    const tq = timeOf(positions[q]!);
    for (let p = q - 1; p >= 0; p--) {
      const length = tq - timeOf(positions[p]!);
      if (length < MIN_SECONDS) continue;
      if (length > longest) break;
      if (score[p] === -Infinity) continue;
      const beatsLong = positions[q]! - positions[p]!;
      const off = Math.log2(length / target(positions[p]!, positions[q]!));
      const candidate =
        score[p]! +
        worth(positions[q]!) -
        LENGTH_WEIGHT * off * off -
        (MUSICAL_LENGTHS.has(beatsLong) ? 0 : ODD_LENGTH);
      if (candidate > score[q]!) {
        score[q] = candidate;
        back[q] = p;
      }
    }
  }
  const last = positions.length - 1;
  if (score[last] === -Infinity) return null;
  const out: CutPosition[] = [];
  for (let q = last; q >= 0; q = back[q]!) out.push(positions[q]!);
  return out.reverse();
}
