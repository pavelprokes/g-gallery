import { describe, expect, it } from "vitest";
import {
  DEFAULT_SLIDESHOW_SECONDS,
  MAX_SLIDESHOW_SECONDS,
  MIN_SLIDESHOW_SECONDS,
  slideshowTiming,
} from "./slideshow-settings";

describe("slideshowTiming", () => {
  it("falls back to the default when nothing is set", () => {
    expect(slideshowTiming(undefined).advanceMs).toBe(DEFAULT_SLIDESHOW_SECONDS * 1000);
    expect(slideshowTiming("").advanceMs).toBe(DEFAULT_SLIDESHOW_SECONDS * 1000);
  });

  it("uses a valid override", () => {
    expect(slideshowTiming("10").advanceMs).toBe(10_000);
    expect(slideshowTiming("2.5").advanceMs).toBe(2_500);
  });

  it("clamps rather than trusting the value", () => {
    expect(slideshowTiming("0.1").advanceMs).toBe(MIN_SLIDESHOW_SECONDS * 1000);
    expect(slideshowTiming("999").advanceMs).toBe(MAX_SLIDESHOW_SECONDS * 1000);
  });

  it("never produces a zero interval from junk — that would strobe a room", () => {
    for (const junk of ["0", "-5", "abc", "NaN", "Infinity"]) {
      expect(slideshowTiming(junk).advanceMs).toBe(DEFAULT_SLIDESHOW_SECONDS * 1000);
    }
  });

  it("keeps the fade comfortably inside the interval", () => {
    for (const seconds of ["1", "3", "6", "20", "60"]) {
      const { advanceMs, fadeMs } = slideshowTiming(seconds);
      expect(fadeMs).toBeGreaterThan(0);
      expect(fadeMs).toBeLessThan(advanceMs / 2);
    }
  });

  it("caps the fade so a slow projection does not fade for ten seconds", () => {
    expect(slideshowTiming("60").fadeMs).toBe(2_000);
  });
});
