import { describe, expect, it } from "vitest";
import type { BeatAnalysis } from "@/lib/reels/beats";
import { barAt, beatsPerCut, loudness, planReel, sections, shiftSection } from "@/lib/reels/cuts";
import { FPS, slidesAt } from "@/lib/social-video/timeline";

/** A steady grid: `bpm` for `seconds`, bars from `downbeat`, loud where `loud` says. */
function grid(
  bpm: number,
  seconds: number,
  { downbeat = 0, loud = () => 0.5 }: { downbeat?: number; loud?: (t: number) => number } = {},
): BeatAnalysis {
  const beats = Array.from({ length: Math.floor((seconds * bpm) / 60) }, (_, i) => (i * 60) / bpm);
  return {
    v: 3,
    duration: seconds,
    bpm,
    beats,
    downbeat,
    energy: beats.map(loud),
    strength: beats.map(() => 0.5),
    hits: [],
    hitStrength: [],
    density: beats.map(loud),
  };
}

describe("beatsPerCut", () => {
  it("groups beats musically, nearest the pace", () => {
    expect(beatsPerCut(60 / 128, "beat")).toBe(2);
    expect(beatsPerCut(60 / 128, "fast")).toBe(1);
    expect(beatsPerCut(60 / 128, "calm")).toBe(4);
    expect(beatsPerCut(60 / 70, "beat")).toBe(1);
    expect(beatsPerCut(60 / 174, "beat")).toBe(4);
  });
});

describe("planReel", () => {
  const song = grid(128, 180);

  it("cuts every second beat, ends on a bar near the length, holds the last photo", () => {
    const plan = planReel(song, {
      startBeat: 32,
      seconds: 15,
      pace: "beat",
      accents: false,
      maxPhotos: 100,
    });
    expect(plan.beatsPerCut).toBe(2);
    expect(plan.offset).toBeCloseTo(song.beats[32]!);
    expect((plan.endBeat - plan.startBeat) % 4).toBe(0);
    expect(Math.abs(plan.timeline.duration - 15)).toBeLessThan(1);
    const { slides } = plan.timeline;
    expect(slides[0]!.start).toBe(0);
    // Every cut on a beat, snapped to a frame.
    for (const slide of slides) {
      const beat = (slide.start * 128) / 60;
      expect(Math.abs(beat - Math.round(beat))).toBeLessThan((128 / 60) * (0.5 / FPS) + 1e-9);
      expect(Math.abs(slide.start * FPS - Math.round(slide.start * FPS))).toBeLessThan(1e-9);
    }
    expect(slides.at(-1)!.end).toBe(plan.timeline.duration);
    expect(plan.timeline.duration - slides.at(-1)!.start).toBeCloseTo(plan.fadeOut, 1);
    expect(plan.timeline.fade).toBe(0);
  });

  it("shows exactly one photo at a time", () => {
    const plan = planReel(song, {
      startBeat: 0,
      seconds: 15,
      pace: "fast",
      accents: true,
      maxPhotos: 100,
    });
    for (let f = 0; f < plan.timeline.duration * FPS; f++) {
      const visible = slidesAt(plan.timeline, f / FPS);
      expect(visible).toHaveLength(1);
      expect(visible[0]!.alpha).toBe(1);
    }
  });

  it("splits the last cut of each phrase with accents", () => {
    const steady = planReel(song, {
      startBeat: 0,
      seconds: 30,
      pace: "beat",
      accents: false,
      maxPhotos: 100,
    });
    const accented = planReel(song, {
      startBeat: 0,
      seconds: 30,
      pace: "beat",
      accents: true,
      maxPhotos: 100,
    });
    expect(accented.timeline.slides.length).toBeGreaterThan(steady.timeline.slides.length);
    const lengths = accented.timeline.slides.slice(0, -1).map((s) => s.end - s.start);
    expect(Math.min(...lengths)).toBeLessThan(Math.max(...lengths) * 0.6);
  });

  it("cuts less often when there are too few photos", () => {
    const plan = planReel(song, {
      startBeat: 0,
      seconds: 30,
      pace: "beat",
      accents: false,
      maxPhotos: 10,
    });
    expect(plan.timeline.slides.length).toBeLessThanOrEqual(10);
    expect(plan.beatsPerCut).toBeGreaterThan(2);
  });

  it("makes do with a song shorter than the reel", () => {
    const short = grid(120, 6);
    const plan = planReel(short, {
      startBeat: 0,
      seconds: 30,
      pace: "beat",
      accents: false,
      maxPhotos: 50,
    });
    expect(plan.timeline.duration).toBeLessThan(8);
    expect(plan.timeline.slides.length).toBeGreaterThan(1);
  });
});

describe("sections", () => {
  it("starts on the loudest stretch, on a bar, and offers others apart from it", () => {
    const song = grid(120, 180, { downbeat: 1, loud: (t) => (t > 60 && t < 80 ? 1 : 0.3) });
    const [first, second] = sections(song, 15, 3);
    expect((first! - 1) % 4).toBe(0);
    expect(song.beats[first!]).toBeGreaterThanOrEqual(60);
    expect(song.beats[first!]! + 15).toBeLessThanOrEqual(80.5);
    expect(Math.abs(second! - first!)).toBeGreaterThanOrEqual(15);
  });

  it("falls back to the first bar of a short song", () => {
    expect(sections(grid(120, 5, { downbeat: 2 }), 15, 3)).toEqual([2]);
  });
});

describe("shiftSection", () => {
  it("moves by bars and stays inside the track", () => {
    const song = grid(120, 60, { downbeat: 1 });
    expect(shiftSection(song, 9, 4)).toBe(25);
    expect(shiftSection(song, 9, -10)).toBe(1);
    expect(shiftSection(song, 9, 1000)).toBe(song.beats.length - ((song.beats.length - 2) % 4) - 1);
  });
});

describe("barAt", () => {
  it("lands on the bar start nearest the time", () => {
    // 120 BPM: a beat every 0.5 s, bars from beat 1 (0.5 s, 2.5 s, 4.5 s…).
    const song = grid(120, 60, { downbeat: 1 });
    expect(barAt(song, 2.4)).toBe(5);
    expect(barAt(song, 3.6)).toBe(9);
    expect(barAt(song, 0)).toBe(1);
    expect(barAt(song, 999)).toBe(song.beats.length - ((song.beats.length - 2) % 4) - 1);
  });
});

describe("loudness", () => {
  it("is the song's shape, scaled to its loudest slice", () => {
    const song = grid(120, 60, { loud: (t) => (t >= 30 ? 0.8 : 0.2) });
    const shape = loudness(song, 6);
    expect(shape).toHaveLength(6);
    expect(shape.slice(3)).toEqual([1, 1, 1]);
    expect(shape[0]).toBeCloseTo(0.25);
  });

  it("is flat zero for silence", () => {
    expect(loudness(grid(120, 10, { loud: () => 0 }), 4)).toEqual([0, 0, 0, 0]);
  });
});
