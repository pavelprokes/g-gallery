import { describe, expect, it } from "vitest";
import { analyzeBeats } from "@/lib/reels/beats";

const RATE = 44100;

/** A drum machine: a decaying noise burst on every beat, louder on `accentPhase`
 * of each bar, from `start` seconds, over a quiet hum. */
function drums({
  bpm,
  seconds,
  start = 0,
  accentPhase = 0,
}: {
  bpm: number;
  seconds: number;
  start?: number;
  accentPhase?: number;
}) {
  const samples = new Float32Array(Math.round(seconds * RATE));
  let seed = 1;
  const noise = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647 - 0.5;
  };
  for (let i = 0; i < samples.length; i++)
    samples[i] = 0.02 * Math.sin((2 * Math.PI * 110 * i) / RATE);
  const beat = 60 / bpm;
  const hits: number[] = [];
  for (let k = 0, t = start; t < seconds; k++, t = start + k * beat) {
    hits.push(t);
    const gain = k % 4 === accentPhase ? 1 : 0.45;
    const at = Math.round(t * RATE);
    for (let i = 0; i < 0.06 * RATE && at + i < samples.length; i++) {
      samples[at + i]! += gain * noise() * Math.exp(-i / (0.012 * RATE));
    }
  }
  return { samples, hits };
}

describe("analyzeBeats", () => {
  it.each([96, 120, 128, 140])("finds %i BPM and lands on the hits", (bpm) => {
    const { samples, hits } = drums({ bpm, seconds: 30 });
    const result = analyzeBeats(samples, RATE);
    expect(result.bpm).toBeGreaterThan(bpm * 0.97);
    expect(result.bpm).toBeLessThan(bpm * 1.03);
    // Every found beat within 20 ms of a hit (a frame at 30 fps is 33 ms).
    for (const t of result.beats) {
      const nearest = Math.min(...hits.map((h) => Math.abs(h - t)));
      expect(nearest).toBeLessThan(0.02);
    }
    expect(result.beats.length).toBeGreaterThan(hits.length * 0.9);
    expect(result.energy).toHaveLength(result.beats.length);
  });

  it("skips a silent intro", () => {
    const { samples } = drums({ bpm: 120, seconds: 20, start: 4 });
    const result = analyzeBeats(samples, RATE);
    expect(result.beats[0]).toBeGreaterThan(3.9);
  });

  it("finds the bar's first beat from the accents", () => {
    const { samples } = drums({ bpm: 120, seconds: 30, accentPhase: 2 });
    const result = analyzeBeats(samples, RATE);
    // Beat 0 of the song is at 0 s; the accent falls on beats 2, 6, 10…
    const first = result.beats[result.downbeat]!;
    expect(Math.round(first / 0.5) % 4).toBe(2);
  });

  it("gives silence a grid at the prior's tempo rather than nothing", () => {
    const result = analyzeBeats(new Float32Array(RATE * 10), RATE);
    expect(result.beats.length).toBeGreaterThan(10);
    expect(result.energy.every((e) => e === 0)).toBe(true);
  });
});
