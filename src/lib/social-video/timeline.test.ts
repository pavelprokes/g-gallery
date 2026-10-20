import { describe, expect, it } from "vitest";
import {
  buildTimeline,
  FADE_SECONDS,
  FIRST_SECONDS,
  HOLD_SECONDS,
  photoCountFor,
  slidesAt,
} from "@/lib/social-video/timeline";

describe("photoCountFor", () => {
  it("fits six photos in 15 s and twelve in 30 s at the usual pace", () => {
    expect(photoCountFor(15)).toBe(6);
    expect(photoCountFor(30)).toBe(12);
  });
});

describe("buildTimeline", () => {
  it("fits the slides to the length asked for", () => {
    const t = buildTimeline(6, 15);
    expect(t.duration).toBeCloseTo(15);
    expect(t.slides[0]).toMatchObject({ start: 0, end: FIRST_SECONDS + FADE_SECONDS });
    expect(t.slides[1]!.start).toBe(FIRST_SECONDS);
    expect(t.slides.at(-1)).toMatchObject({ end: 15, moveEnd: 15 - HOLD_SECONDS });
  });

  it("does not rush or drag past its bounds — the video gets longer or shorter instead", () => {
    expect(buildTimeline(20, 15).duration).toBeGreaterThan(15);
    expect(buildTimeline(3, 30).duration).toBeLessThan(30);
  });

  it("is empty for no photos", () => {
    expect(buildTimeline(0, 15)).toEqual({ slides: [], duration: 0, fade: FADE_SECONDS });
  });
});

describe("slidesAt", () => {
  const t = buildTimeline(6, 15);

  it("shows one slide, then two while the next fades in over it", () => {
    expect(slidesAt(t, 1).map((s) => s.index)).toEqual([0]);
    const fading = slidesAt(t, FIRST_SECONDS + FADE_SECONDS / 2);
    expect(fading.map((s) => s.index)).toEqual([0, 1]);
    expect(fading[0]!.alpha).toBe(1);
    expect(fading[1]!.alpha).toBeCloseTo(0.5);
    // Both still moving: the slide underneath has not reached its end.
    expect(fading[0]!.progress).toBeLessThan(1);
  });

  it("brings the last slide to rest before the end and still draws the end itself", () => {
    const last = t.slides.length - 1;
    expect(slidesAt(t, t.duration - HOLD_SECONDS / 2)).toEqual([
      { index: last, progress: 1, alpha: 1 },
    ]);
    expect(slidesAt(t, t.duration)).toEqual([{ index: last, progress: 1, alpha: 1 }]);
  });
});

describe("a pacing of its own", () => {
  const quick = { first: 1.6, slide: 1.2, minSlide: 0.9, maxSlide: 1.8, fade: 0.2, hold: 0.4 };

  it("lays the slides out and fades by it", () => {
    const t = buildTimeline(5, 1.6 + 4 * 1.2, quick);
    expect(t.duration).toBeCloseTo(6.4, 5);
    expect(t.slides[1]).toMatchObject({ start: 1.6 });
    expect(t.slides[1]!.end).toBeCloseTo(1.6 + 1.2 + 0.2, 5);
    expect(slidesAt(t, 1.7).at(-1)!.alpha).toBeCloseTo(0.5, 5);
  });
});
