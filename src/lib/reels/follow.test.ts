import { describe, expect, it } from "vitest";
import type { BeatAnalysis } from "@/lib/reels/beats";
import { changes, followCuts, intensity, positionTime } from "@/lib/reels/follow";

/** 120 BPM (a beat every 0.5 s), bars from beat 0: a sparse verse, then a
 * busy chorus from `chorusAt` seconds, with a stab on `stab` if given. */
function song({
  seconds = 60,
  chorusAt = 30,
  stab,
}: { seconds?: number; chorusAt?: number; stab?: number } = {}): BeatAnalysis {
  const beats = Array.from({ length: seconds * 2 }, (_, i) => i / 2);
  const busy = (t: number) => t >= chorusAt;
  return {
    v: 2,
    duration: seconds,
    bpm: 120,
    beats,
    downbeat: 0,
    energy: beats.map((t) => (busy(t) ? 0.95 : 0.75)),
    strength: beats.map((_, i) => (i === stab ? 1 : i % 4 === 0 ? 0.35 : 0.25)),
    offbeat: beats.map((t) => (busy(t) ? 0.4 : 0.02)),
    density: beats.map((t) => (busy(t) ? 0.65 : 0.22)),
  };
}

const lengths = (analysis: BeatAnalysis, cuts: number[]) =>
  cuts.slice(1).map((p, i) => positionTime(analysis, p) - positionTime(analysis, cuts[i]!));

describe("intensity", () => {
  it("reads the busy part as intense, the sparse part as calm", () => {
    const level = intensity(song());
    expect(level[20]).toBeLessThan(0.2);
    expect(level[100]).toBeGreaterThan(0.8);
  });

  it("keeps a song that hardly changes at an even 0.5", () => {
    const flat = {
      ...song(),
      density: song().density.map(() => 0.5),
      energy: song().energy.map(() => 0.8),
    };
    expect(new Set(intensity(flat))).toEqual(new Set([0.5]));
  });
});

describe("changes", () => {
  it("finds the bar where the verse turns into the chorus", () => {
    expect([...changes(song({ chorusAt: 30 }))]).toEqual([60]);
  });
});

describe("followCuts", () => {
  const base = 1; // two beats at 120 BPM

  it("holds the photos longer in the verse and cuts on every beat in the chorus", () => {
    const analysis = song();
    const cuts = followCuts(analysis, { startBeat: 44, endBeat: 76, base, faster: false })!;
    expect(cuts[0]).toBe(44);
    expect(cuts.at(-1)).toBe(76);
    const times = cuts.map((p) => positionTime(analysis, p));
    const verse = lengths(analysis, cuts).filter((_, i) => times[i + 1]! <= 30);
    const chorus = lengths(analysis, cuts).filter((_, i) => times[i]! >= 31);
    expect(Math.min(...verse)).toBeGreaterThanOrEqual(1);
    expect(Math.max(...chorus)).toBeLessThanOrEqual(0.5);
  });

  it("cuts where the chorus starts", () => {
    const cuts = followCuts(song(), { startBeat: 48, endBeat: 72, base, faster: false })!;
    expect(cuts).toContain(60);
  });

  it("puts a cut on a stab", () => {
    const analysis = song({ chorusAt: 100, stab: 31 });
    const cuts = followCuts(analysis, { startBeat: 20, endBeat: 44, base, faster: false })!;
    expect(cuts).toContain(31);
  });

  it("never shows a photo for less than 0.3 s, even faster", () => {
    const analysis = song({ chorusAt: 0 });
    const cuts = followCuts(analysis, { startBeat: 8, endBeat: 40, base: 0.5, faster: true })!;
    expect(Math.min(...lengths(analysis, cuts))).toBeGreaterThanOrEqual(0.3);
  });

  it("refuses a reel with no room for a cut", () => {
    expect(followCuts(song(), { startBeat: 10, endBeat: 10, base, faster: false })).toBeNull();
  });
});
