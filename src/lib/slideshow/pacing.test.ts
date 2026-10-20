import { describe, expect, it } from "vitest";
import { buildTimeline } from "@/lib/social-video/timeline";
import { defaultLength, keptLength, lengthOptions, PACINGS } from "./pacing";

describe("lengthOptions", () => {
  it("offers only lengths the rhythm reaches with every photo in", () => {
    // 20 photos, calm: 3 + 19 × 1.8…4 s = 37.2…79 s.
    expect(lengthOptions(20, "normal")).toEqual([45, 60]);
    // Dynamic: 1.6 + 19 × 0.9…1.8 s = 18.7…35.8 s.
    expect(lengthOptions(20, "dynamic")).toEqual([20, 30]);
  });

  it("falls back to the rhythm's own length when no step fits", () => {
    expect(lengthOptions(3, "dynamic")).toEqual([4]);
  });

  it("is never empty, from one photo to sixty", () => {
    for (let n = 1; n <= 60; n++) {
      expect(lengthOptions(n, "normal").length).toBeGreaterThan(0);
      expect(lengthOptions(n, "dynamic").length).toBeGreaterThan(0);
    }
  });

  it("every offered length is what the timeline then makes", () => {
    for (const mode of ["normal", "dynamic"] as const) {
      for (const n of [5, 12, 30, 60]) {
        for (const seconds of lengthOptions(n, mode)) {
          const timeline = buildTimeline(n, seconds, PACINGS[mode]);
          expect(timeline.duration).toBeCloseTo(seconds, 5);
          expect(timeline.slides).toHaveLength(n);
        }
      }
    }
  });
});

describe("defaultLength", () => {
  it("is the offered length nearest the natural pace", () => {
    // 20 photos at 2.5 s: 50.5 s.
    expect(defaultLength(20, "normal")).toBe(45);
    // 20 photos at 1.2 s: 24.4 s.
    expect(defaultLength(20, "dynamic")).toBe(20);
  });
});

describe("keptLength", () => {
  it("keeps a choice that is still offered and replaces one that is not", () => {
    expect(keptLength(60, 20, "normal")).toBe(60);
    expect(keptLength(15, 20, "normal")).toBe(45);
  });
});
