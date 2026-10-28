// Cuts that follow the song (docs/REELS.md §3, "Podle písničky"): a cut on
// every hit that stands out from the music around it — the kick and snare of
// a verse, a stab, the hit after a break — wherever it falls against the
// beat, and a photo that holds where nothing is hit. Not a grid: the cuts
// sit on what is heard, so a syncopated riff, a waltz or a song that drifts
// in tempo is cut where it hits. A dynamic programme (Ellis' kind, one level
// up) picks the chain from the reel's first bar to its last that takes the
// most salient hits while no photo is shorter than a face can be read in.
// Pure: a `BeatAnalysis` in, cut times out.

import type { BeatAnalysis } from "@/lib/reels/beats";

const BEATS_PER_BAR = 4;
/** A cut on a change of section — a verse into a chorus, a break — is worth this much more. */
const CHANGE = 1.2;

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
  return remembered(changeCache, analysis, findChanges);
}

/** Per analysis, computed once: every variant and every drag of the song's part asks again. */
const changeCache = new WeakMap<BeatAnalysis, Set<number>>();
const salienceCache = new WeakMap<BeatAnalysis, number[]>();

function remembered<T>(
  cache: WeakMap<BeatAnalysis, T>,
  analysis: BeatAnalysis,
  of: (a: BeatAnalysis) => T,
): T {
  let value = cache.get(analysis);
  if (value === undefined) {
    value = of(analysis);
    cache.set(analysis, value);
  }
  return value;
}

function findChanges(analysis: BeatAnalysis): Set<number> {
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

export interface FollowOptions {
  startBeat: number;
  endBeat: number;
  /** Takes fainter hits and shorter photos (the "Se zrychlením" variant). */
  faster: boolean;
  /** The photos there are: no more cuts than this — the last one included. */
  photos?: number;
}

/** A hit counts as much as it stands out: against the hits of the last few
 * seconds — and barely ahead, so a chorus's first hit stands out from the
 * verse and the verse's last hits are not dwarfed by the chorus to come. */
const LOOK_BACK = 3;
const LOOK_AHEAD = 0.3;
/** A cut on a hit only as salient as this breaks even. */
const COST = { usual: 0.6, faster: 0.45 };
/** No photo shorter: a face read, a beat at ~170 BPM still cut. */
const SHORTEST = { usual: 0.42, faster: 0.27 };
/** Past this a still photo starts to drag, unless nothing is hit to cut on. */
const LONG_HOLD = 3;
const LONG_HOLD_COST = 0.8;
/** A hit this near a bar start or a change of section counts as on it. */
const NEAR = 0.06;
const ON_BAR = 0.15;

/**
 * How much each hit stands out: its strength against the louder hits just
 * before it (their 75th percentile), so a verse's quiet kick counts like a
 * chorus's loud one and a stab after a break counts most.
 */
export function salience(analysis: BeatAnalysis): number[] {
  return remembered(salienceCache, analysis, findSalience);
}

function findSalience(analysis: BeatAnalysis): number[] {
  const { hits, hitStrength } = analysis;
  let lo = 0;
  let hi = 0;
  return hits.map((t, i) => {
    while (hits[lo]! < t - LOOK_BACK) lo++;
    while (hi < hits.length && hits[hi]! <= t + LOOK_AHEAD) hi++;
    const around = hitStrength.slice(lo, hi).toSorted((a, b) => a - b);
    const reference = Math.max(0.12, around[Math.floor(0.75 * (around.length - 1))] ?? 0);
    return Math.min(3, hitStrength[i]! / reference);
  });
}

/**
 * The cut times, seconds into the track, from the bar at `startBeat` to the
 * bar at `endBeat`, both included — the last is where the final photo starts
 * and holds. Null when the reel has no room.
 */
export function followCuts(analysis: BeatAnalysis, options: FollowOptions): number[] | null {
  const { beats } = analysis;
  const { startBeat, endBeat, faster } = options;
  if (endBeat <= startBeat || endBeat >= beats.length) return null;
  const from = beats[startBeat]!;
  const to = beats[endBeat]!;
  const shortest = faster ? SHORTEST.faster : SHORTEST.usual;
  const cost = faster ? COST.faster : COST.usual;
  const standOut = salience(analysis);
  const turns = [...changes(analysis)].map((i) => beats[i]!);
  const bars: number[] = [];
  for (let i = analysis.downbeat; i < beats.length; i += BEATS_PER_BAR) bars.push(beats[i]!);
  const near = (t: number, list: readonly number[]) => list.some((x) => Math.abs(x - t) <= NEAR);

  const times = [from];
  const gains = [0];
  analysis.hits.forEach((t, i) => {
    if (t < from + shortest || t > to - shortest) return;
    times.push(t);
    gains.push(standOut[i]! - cost + (near(t, bars) ? ON_BAR : 0) + (near(t, turns) ? CHANGE : 0));
  });
  times.push(to);
  gains.push(0);

  const free = chain(times, gains, shortest, () => 0);
  if (!free || !options.photos || free.length <= options.photos) return free;
  // Fewer photos than hits worth a cut: exactly as many cuts as photos, still
  // on hits, each photo kept near an even share of the reel — otherwise the
  // chain would take the first hits and hold the last photo for the rest.
  const photos = Math.max(2, options.photos);
  const even = (to - from) / (photos - 1);
  return (
    chain(
      times,
      gains,
      shortest,
      (length) => EVEN_WEIGHT * Math.log2(length / even) ** 2,
      photos,
    ) ?? free
  );
}

/** How hard a photo is held to its even share when the photos run short. */
const EVEN_WEIGHT = 1.5;

/**
 * The best chain of cut times from the first to the last (both kept), cuts
 * at least `shortest` apart: each cut earns its gain, a hold past LONG_HOLD
 * costs, and `shape` prices each length. With `most`, the chain has at most
 * that many cuts — the same programme over (cut, cuts so far).
 */
function chain(
  times: readonly number[],
  gains: readonly number[],
  shortest: number,
  shape: (length: number) => number,
  most?: number,
): number[] | null {
  const n = times.length;
  const step = (p: number, q: number) => {
    const length = times[q]! - times[p]!;
    if (length < shortest) return null;
    return gains[q]! - LONG_HOLD_COST * Math.max(0, length - LONG_HOLD) - shape(length);
  };
  // Without a limit, one best chain per cut; with one, one per cut and count.
  const counts = most ?? 1;
  const at = (q: number, c: number) => q * (counts + 1) + c;
  const score = new Float64Array(n * (counts + 1)).fill(-Infinity);
  const back = new Int32Array(n * (counts + 1)).fill(-1);
  score[at(0, 1)] = 0;
  for (let q = 1; q < n; q++) {
    for (let p = 0; p < q; p++) {
      const gain = step(p, q);
      if (gain === null) continue;
      if (most === undefined) {
        const candidate = score[at(p, 1)]! + gain;
        if (candidate > score[at(q, 1)]!) {
          score[at(q, 1)] = candidate;
          back[at(q, 1)] = at(p, 1);
        }
        continue;
      }
      for (let c = 1; c < counts; c++) {
        const candidate = score[at(p, c)]! + gain;
        if (candidate > score[at(q, c + 1)]!) {
          score[at(q, c + 1)] = candidate;
          back[at(q, c + 1)] = at(p, c);
        }
      }
    }
  }
  let end = -1;
  for (let c = 1; c <= counts; c++) {
    const i = at(n - 1, c);
    if (score[i]! > -Infinity && (end < 0 || score[i]! > score[end]!)) end = i;
  }
  if (end < 0) return null;
  const out: number[] = [];
  for (let i = end; i >= 0; i = back[i]!) out.push(times[Math.floor(i / (counts + 1))]!);
  return out.reverse();
}
