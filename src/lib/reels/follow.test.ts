import { describe, expect, it } from "vitest";
import type { BeatAnalysis } from "@/lib/reels/beats";
import { changes, followCuts, intensity, salience } from "@/lib/reels/follow";

/**
 * 120 BPM (a beat every 0.5 s), bars from beat 0. A verse with a soft hit on
 * every beat, a chorus from `chorusAt` with loud beats and off-beats, and
 * whatever `extra` hits (seconds → strength) a case needs; `silent` spans
 * have no hits at all.
 */
function song({
  seconds = 60,
  chorusAt = 30,
  silent = [] as [number, number][],
  extra = [] as [number, number][],
  onBeats = true,
} = {}): BeatAnalysis {
  const beats = Array.from({ length: seconds * 2 }, (_, i) => i / 2);
  const busy = (t: number) => t >= chorusAt;
  const quiet = (t: number) => silent.some(([a, b]) => t >= a && t < b);
  const hits = new Map<number, number>();
  if (onBeats) {
    for (const t of beats) {
      if (quiet(t)) continue;
      hits.set(t, busy(t) ? 0.7 : 0.25);
      if (busy(t)) hits.set(t + 0.25, 0.35);
    }
  }
  for (const [t, s] of extra) hits.set(t, s);
  const sorted = [...hits.entries()].sort((a, b) => a[0] - b[0]);
  return {
    v: 3,
    duration: seconds,
    bpm: 120,
    beats,
    downbeat: 0,
    energy: beats.map((t) => (quiet(t) ? 0.2 : busy(t) ? 0.95 : 0.75)),
    strength: beats.map((t) => hits.get(t) ?? 0),
    offbeat: beats.map((t) => hits.get(t + 0.25) ?? 0),
    density: beats.map((t) => (quiet(t) ? 0.02 : busy(t) ? 0.65 : 0.22)),
    hits: sorted.map(([t]) => t),
    hitStrength: sorted.map(([, s]) => s),
  };
}

const gaps = (cuts: number[]) => cuts.slice(1).map((t, i) => t - cuts[i]!);

describe("salience", () => {
  it("weighs a hit against the hits around it, so a verse's soft kick counts like a chorus's loud one", () => {
    const analysis = song();
    const of = (t: number) => salience(analysis)[analysis.hits.indexOf(t)]!;
    expect(of(10)).toBeCloseTo(of(45), 1);
    expect(of(45.25)).toBeLessThan(of(45));
  });
});

describe("intensity and changes", () => {
  it("reads the chorus as intense and finds the bar it starts on", () => {
    const analysis = song();
    expect(intensity(analysis)[20]).toBeLessThan(0.2);
    expect(intensity(analysis)[100]).toBeGreaterThan(0.8);
    expect([...changes(analysis)]).toEqual([60]);
  });
});

describe("followCuts", () => {
  it("cuts on every beat that is hit, the soft verse as well as the loud chorus", () => {
    const cuts = followCuts(song(), { startBeat: 48, endBeat: 72, faster: false })!;
    expect(cuts[0]).toBe(24);
    expect(cuts.at(-1)).toBe(36);
    expect(gaps(cuts).every((g) => g === 0.5)).toBe(true);
  });

  it("takes the fainter off-beat hits only when asked for faster cuts", () => {
    // 100 BPM: a beat every 0.6 s, hit hard, and a softer hit halfway between.
    const beats = Array.from({ length: 60 }, (_, i) => i * 0.6);
    const hits = beats.flatMap((t) => [t, t + 0.3]);
    const analysis: BeatAnalysis = {
      ...song({ seconds: 36 }),
      bpm: 100,
      beats,
      hits,
      hitStrength: hits.map((_, i) => (i % 2 ? 0.45 : 0.7)),
    };
    const usual = followCuts(analysis, { startBeat: 8, endBeat: 24, faster: false })!;
    const faster = followCuts(analysis, { startBeat: 8, endBeat: 24, faster: true })!;
    expect(gaps(usual).every((g) => Math.abs(g - 0.6) < 1e-9)).toBe(true);
    expect(gaps(faster).every((g) => Math.abs(g - 0.3) < 1e-9)).toBe(true);
  });

  it("holds over a break and cuts on the hit after it", () => {
    const analysis = song({ silent: [[14, 16]], extra: [[16, 1]] });
    const cuts = followCuts(analysis, { startBeat: 20, endBeat: 40, faster: false })!;
    expect(cuts).toContain(16);
    expect(cuts).toContain(13.5);
    expect(cuts.filter((t) => t > 13.5 && t < 16)).toEqual([]);
  });

  it("cuts where a syncopated riff hits, off the beat grid", () => {
    const riff: [number, number][] = [];
    for (let bar = 5; bar < 10; bar++)
      for (const at of [0, 0.75, 1.25]) riff.push([bar * 2 + at, 0.8]);
    const analysis = song({ onBeats: false, chorusAt: 100, extra: riff });
    const cuts = followCuts(analysis, { startBeat: 20, endBeat: 36, faster: false })!;
    const inner = cuts.slice(1, -1);
    expect(inner.length).toBeGreaterThan(8);
    expect(inner.every((t) => riff.some(([r]) => r === t))).toBe(true);
  });

  it("with fewer photos than hits: as many cuts as photos, on hits, spread over the reel", () => {
    const analysis = song({ extra: [[12.5, 1]] });
    const all = followCuts(analysis, { startBeat: 20, endBeat: 36, faster: false })!;
    const few = followCuts(analysis, { startBeat: 20, endBeat: 36, faster: false, photos: 6 })!;
    expect(all.length).toBeGreaterThan(6);
    expect(few).toHaveLength(6);
    expect(few.slice(1, -1).every((t) => analysis.hits.includes(t))).toBe(true);
    expect(Math.max(...gaps(few))).toBeLessThan(2.5);
    expect(few).toContain(12.5);
  });

  it("refuses a reel with no room", () => {
    expect(followCuts(song(), { startBeat: 10, endBeat: 10, faster: false })).toBeNull();
  });
});
