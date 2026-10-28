import { describe, expect, it } from "vitest";
import { analyzeBeats } from "@/lib/reels/beats";

// Tempo across styles (docs/REELS.md §2): drum patterns synthesised here —
// kick, snare, hats, a bass line — at 70–180 BPM, the spread @audio/beat's
// benchmark uses (github.com/audiojs/beat, test.js). The octave is the hard
// part: a hi-hat on every eighth or a syncopated kick doubles or halves a
// naive estimate, and a reel cut at double the tempo feels frantic.

const RATE = 44100;

function rng(seed: number) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647 - 0.5;
  };
}

type Hit = "kick" | "snare" | "hat" | "open" | "bass";
/** A bar of sixteenths: which hits sound on each. */
type Pattern = Partial<Record<Hit, number[]>>;

function render(bpm: number, bars: number, pattern: Pattern, seed = 7): Float32Array {
  const sixteenth = 60 / bpm / 4;
  const out = new Float32Array(Math.ceil(bars * 16 * sixteenth * RATE) + RATE);
  const noise = rng(seed);
  const add = (at: number, length: number, sample: (t: number) => number) => {
    const from = Math.round(at * RATE);
    for (let i = 0; i < length * RATE && from + i < out.length; i++)
      out[from + i]! += sample(i / RATE);
  };
  for (let bar = 0; bar < bars; bar++) {
    for (const [hit, steps] of Object.entries(pattern) as [Hit, number[]][]) {
      for (const step of steps) {
        const at = (bar * 16 + step) * sixteenth;
        if (hit === "kick")
          add(
            at,
            0.18,
            (t) =>
              Math.sin(2 * Math.PI * (50 + 100 * Math.exp(-40 * t)) * t) * Math.exp(-12 * t) * 0.8,
          );
        if (hit === "snare")
          add(
            at,
            0.12,
            (t) =>
              (Math.sin(2 * Math.PI * 185 * t) * 0.3 + noise() * 0.8) * Math.exp(-22 * t) * 0.6,
          );
        if (hit === "hat") add(at, 0.04, (t) => noise() * Math.exp(-90 * t) * 0.25);
        if (hit === "open") add(at, 0.2, (t) => noise() * Math.exp(-14 * t) * 0.2);
        if (hit === "bass")
          add(
            at,
            sixteenth * 3,
            (t) => Math.tanh(Math.sin(2 * Math.PI * 55 * t) * 1.5) * Math.min(1, t * 40) * 0.3,
          );
      }
    }
  }
  return out;
}

const every = (from: number, step: number) =>
  Array.from({ length: 16 / step }, (_, i) => from + i * step);

const STYLES: Record<string, Pattern> = {
  rock: { kick: [0, 8, 10], snare: [4, 12], hat: every(0, 2) },
  edm: { kick: every(0, 4), snare: [4, 12], open: every(2, 4), bass: every(2, 4) },
  hiphop: { kick: [0, 7, 10], snare: [4, 12], hat: every(0, 2) },
  disco: { kick: every(0, 4), snare: [4, 12], open: every(2, 4), hat: every(0, 2) },
  funk: { kick: [0, 3, 6, 10], snare: [4, 12, 15], hat: every(0, 1) },
  reggae: { kick: [8], snare: [8], hat: every(2, 4) },
  ballad: { kick: [0, 10], snare: [8], hat: every(0, 4) },
  breakbeat: { kick: [0, 10], snare: [4, 7, 12], hat: every(0, 2) },
  shuffle: { kick: [0, 8], snare: [4, 12], hat: [0, 3, 4, 7, 8, 11, 12, 15] },
};

const BPMS = [70, 80, 90, 100, 110, 120, 130, 140, 160, 180];

function score(bars: number) {
  let exact = 0;
  let octave = 0;
  const misses: string[] = [];
  for (const [name, pattern] of Object.entries(STYLES)) {
    for (const bpm of BPMS) {
      const found = analyzeBeats(render(bpm, bars, pattern), RATE).bpm;
      const off = (target: number) => Math.abs(found - target) / bpm <= 0.05;
      if (off(bpm)) exact++;
      else misses.push(`${name}@${bpm}→${found}`);
      if (off(bpm) || off(bpm / 2) || off(bpm * 2)) octave++;
    }
  }
  const total = Object.keys(STYLES).length * BPMS.length;
  return { exact: exact / total, octave: octave / total, misses };
}

describe("tempo across styles", () => {
  it("finds the tempo of a 16-bar loop, or its octave, nearly always", () => {
    const { exact, octave, misses } = score(16);
    console.info(
      `exact ${(exact * 100).toFixed(0)} %, octave ${(octave * 100).toFixed(0)} %`,
      misses.join(" "),
    );
    expect(octave).toBeGreaterThanOrEqual(0.9);
    expect(exact).toBeGreaterThanOrEqual(0.7);
  }, 120_000);
});
