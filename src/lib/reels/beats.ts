// The beat of a song, found in the photographer's browser (docs/REELS.md §2):
// an onset envelope from spectral flux, the tempo from its autocorrelation,
// the beats by Ellis' dynamic programme (the one librosa ships as
// `beat_track`), the bar's first beat, and how loud each beat is. Pure and
// client-safe: it reads samples, nothing else.

export const BEATS_VERSION = 1;

export interface BeatAnalysis {
  v: typeof BEATS_VERSION;
  /** The track's length, seconds. */
  duration: number;
  bpm: number;
  /** Every beat, seconds from the track's start. */
  beats: number[];
  /** Which of the first four beats starts a bar (4/4 assumed). */
  downbeat: number;
  /** How loud the music is from each beat to the next, 0–1 against the loudest. */
  energy: number[];
}

/** The rate the envelope is computed at — plenty for onsets, a quarter of the work. */
const ANALYSIS_RATE = 22050;
const FRAME = 1024;
const HOP = 256;
/** Bins above this carry hi-hats and noise more than the beat. */
const MAX_HZ = 8000;
/** Tempo prior: centred here, one octave wide (librosa's defaults). */
const PRIOR_BPM = 120;
const MIN_BPM = 60;
const MAX_BPM = 200;
/** How firmly beats keep to the tempo between onsets (librosa's `tightness`). */
const TIGHTNESS = 100;

/**
 * `samples` is one channel (the caller mixes down), at `sampleRate`. A track
 * with no audible beat still gets a grid — at the prior's tempo, from 0 —
 * so a quiet intro or a ballad never leaves the reel without cuts.
 */
export function analyzeBeats(samples: Float32Array, sampleRate: number): BeatAnalysis {
  const duration = samples.length / sampleRate;
  const { signal, rate } = decimate(samples, sampleRate);
  const onset = onsetEnvelope(signal, rate);
  const fps = rate / HOP;
  // A frame's flux is its jump over the one before: the onset sits a hop past
  // the frame's centre (measured on drum hits: 11 ms early without it).
  const frameTime = (i: number) => ((i + 1) * HOP + FRAME / 2) / rate;

  const period = tempoPeriod(onset, fps);
  const bpm = (60 * fps) / period;
  let frames = trackBeats(onset, period);
  if (frames.length < 2) {
    const step = (60 / PRIOR_BPM) * fps;
    frames = Array.from({ length: Math.floor(onset.length / step) }, (_, i) =>
      Math.round(i * step),
    );
  }
  const beats = frames.map(frameTime).filter((t) => t < duration);
  return {
    v: BEATS_VERSION,
    duration,
    bpm: Math.round(bpm * 10) / 10,
    beats,
    downbeat: downbeatOf(frames, onset),
    energy: beatEnergy(samples, sampleRate, beats),
  };
}

/** Averaged down by a whole factor to about ANALYSIS_RATE. */
function decimate(samples: Float32Array, sampleRate: number) {
  const factor = Math.max(1, Math.floor(sampleRate / ANALYSIS_RATE));
  if (factor === 1) return { signal: samples, rate: sampleRate };
  const signal = new Float32Array(Math.floor(samples.length / factor));
  for (let i = 0; i < signal.length; i++) {
    let sum = 0;
    for (let k = 0; k < factor; k++) sum += samples[i * factor + k]!;
    signal[i] = sum / factor;
  }
  return { signal, rate: sampleRate / factor };
}

/** Log-magnitude spectral flux, half-wave rectified, minus its local mean. */
export function onsetEnvelope(signal: Float32Array, rate: number): Float32Array {
  const count = Math.max(0, Math.floor((signal.length - FRAME) / HOP) + 1);
  const bins = Math.min(FRAME / 2, Math.ceil((MAX_HZ * FRAME) / rate));
  const window = new Float32Array(FRAME);
  for (let i = 0; i < FRAME; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / FRAME);
  const re = new Float64Array(FRAME);
  const im = new Float64Array(FRAME);
  let previous = new Float32Array(bins);
  let current = new Float32Array(bins);
  const flux = new Float32Array(count);
  for (let f = 0; f < count; f++) {
    for (let i = 0; i < FRAME; i++) {
      re[i] = signal[f * HOP + i]! * window[i]!;
      im[i] = 0;
    }
    fft(re, im);
    let sum = 0;
    for (let b = 0; b < bins; b++) {
      current[b] = Math.log1p(100 * Math.hypot(re[b]!, im[b]!));
      if (f > 0) sum += Math.max(0, current[b]! - previous[b]!);
    }
    flux[f] = sum;
    [previous, current] = [current, previous];
  }
  // A crescendo is not an onset: what counts is the jump above the music around it.
  const half = Math.round((0.5 * rate) / HOP);
  const out = new Float32Array(count);
  let windowSum = 0;
  let lo = 0;
  let hi = -1;
  for (let f = 0; f < count; f++) {
    while (hi < Math.min(count - 1, f + half)) windowSum += flux[++hi]!;
    while (lo < f - half) windowSum -= flux[lo++]!;
    out[f] = Math.max(0, flux[f]! - windowSum / (hi - lo + 1));
  }
  const peak = out.reduce((m, v) => Math.max(m, v), 0);
  if (peak > 0) for (let f = 0; f < count; f++) out[f]! /= peak;
  return out;
}

/** The beat period in frames: the autocorrelation's best lag under the tempo prior. */
function tempoPeriod(onset: Float32Array, fps: number): number {
  const minLag = Math.floor((60 * fps) / MAX_BPM);
  const maxLag = Math.min(onset.length - 1, Math.ceil((60 * fps) / MIN_BPM));
  const fallback = (60 * fps) / PRIOR_BPM;
  if (maxLag <= minLag + 1) return fallback;
  const ac = new Float64Array(maxLag + 2);
  for (let lag = minLag - 1; lag <= maxLag + 1; lag++) {
    let sum = 0;
    for (let i = lag; i < onset.length; i++) sum += onset[i]! * onset[i - lag]!;
    ac[lag] = sum / (onset.length - lag);
  }
  let best = -1;
  let bestScore = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    const octaves = Math.log2((60 * fps) / lag / PRIOR_BPM);
    const score = ac[lag]! * Math.exp(-0.5 * octaves * octaves);
    if (score > bestScore) {
      bestScore = score;
      best = lag;
    }
  }
  if (best < 0) return fallback;
  // Between frames: the vertex of the parabola through the peak and its neighbours.
  const [a, b, c] = [ac[best - 1]!, ac[best]!, ac[best + 1]!];
  const denominator = a - 2 * b + c;
  return denominator < 0 ? best + (0.5 * (a - c)) / denominator : best;
}

/** Ellis (2007): the beats that best sit on onsets while keeping to `period`. */
function trackBeats(onset: Float32Array, period: number): number[] {
  const n = onset.length;
  if (n === 0) return [];
  // Each onset smeared by a narrow Gaussian, so a beat a frame off still scores.
  const sigma = period / 32;
  const radius = Math.max(1, Math.ceil(3 * sigma));
  const local = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let k = -radius; k <= radius; k++) {
      const j = i + k;
      if (j >= 0 && j < n) sum += onset[j]! * Math.exp(-0.5 * (k / sigma) ** 2);
    }
    local[i] = sum;
  }
  const score = new Float64Array(n);
  const back = new Int32Array(n).fill(-1);
  const from = Math.round(period / 2);
  const to = Math.round(2 * period);
  for (let i = 0; i < n; i++) {
    let best = 0;
    let bestPrev = -1;
    for (let prev = i - to; prev <= i - from; prev++) {
      if (prev < 0) continue;
      const cost = -TIGHTNESS * Math.log((i - prev) / period) ** 2;
      const candidate = score[prev]! + cost;
      if (bestPrev < 0 || candidate > best) {
        best = candidate;
        bestPrev = prev;
      }
    }
    score[i] = local[i]! + (bestPrev >= 0 ? Math.max(0, best) : 0);
    back[i] = bestPrev >= 0 && best > 0 ? bestPrev : -1;
  }
  // The last beat: the best score within a period of the end.
  let last = n - 1;
  for (let i = Math.max(0, n - Math.ceil(period)); i < n; i++)
    if (score[i]! > score[last]!) last = i;
  const frames: number[] = [];
  for (let i = last; i >= 0; i = back[i]!) frames.push(i);
  frames.reverse();
  // The chain can start in a silent intro; beats before the first onset worth
  // the name are dropped (librosa trims the same way).
  const threshold = 0.1 * Math.max(...frames.map((f) => local[f]!));
  const first = frames.findIndex((f) => local[f]! >= threshold);
  return first > 0 ? frames.slice(first) : frames;
}

/** The phase of the bar — of every fourth beat, the one the onsets hit hardest. */
function downbeatOf(frames: readonly number[], onset: Float32Array): number {
  let best = 0;
  let bestSum = -1;
  for (let phase = 0; phase < 4; phase++) {
    let sum = 0;
    let count = 0;
    for (let i = phase; i < frames.length; i += 4) {
      sum += onset[frames[i]!] ?? 0;
      count += 1;
    }
    const mean = count > 0 ? sum / count : 0;
    if (mean > bestSum) {
      bestSum = mean;
      best = phase;
    }
  }
  return best;
}

/** RMS from each beat to the next, against the loudest. */
function beatEnergy(samples: Float32Array, rate: number, beats: readonly number[]): number[] {
  const rms = beats.map((t, i) => {
    const a = Math.floor(t * rate);
    const b = Math.min(samples.length, Math.floor((beats[i + 1] ?? t + 0.5) * rate));
    let sum = 0;
    for (let k = a; k < b; k++) sum += samples[k]! * samples[k]!;
    return b > a ? Math.sqrt(sum / (b - a)) : 0;
  });
  const loudest = Math.max(0, ...rms);
  return rms.map((r) => (loudest > 0 ? Math.round((r / loudest) * 1000) / 1000 : 0));
}

/** In-place iterative radix-2 FFT; `re.length` must be a power of two. */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const angle = (-2 * Math.PI) / size;
    const wr = Math.cos(angle);
    const wi = Math.sin(angle);
    for (let start = 0; start < n; start += size) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < size / 2; k++) {
        const a = start + k;
        const b = a + size / 2;
        const tr = re[b]! * cr - im[b]! * ci;
        const ti = re[b]! * ci + im[b]! * cr;
        re[b] = re[a]! - tr;
        im[b] = im[a]! - ti;
        re[a]! += tr;
        im[a]! += ti;
        [cr, ci] = [cr * wr - ci * wi, cr * wi + ci * wr];
      }
    }
  }
}
