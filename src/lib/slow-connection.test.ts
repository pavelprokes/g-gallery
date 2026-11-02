import { describe, expect, it } from "vitest";
import { DEVICE_SIZES } from "./image-sizes";
import { isSlowConnection, slowLightboxSizes } from "./slow-connection";

describe("isSlowConnection", () => {
  it("believes Chromium when it says the link is slow or data is saved", () => {
    expect(isSlowConnection({ effectiveType: "3g", imageDurations: [] })).toBe(true);
    expect(isSlowConnection({ effectiveType: "2g", imageDurations: [] })).toBe(true);
    expect(isSlowConnection({ saveData: true, effectiveType: "4g", imageDurations: [] })).toBe(
      true,
    );
    expect(isSlowConnection({ effectiveType: "4g", imageDurations: [] })).toBe(false);
  });

  it("does not second-guess Chromium's own estimate with the image times", () => {
    expect(
      isSlowConnection({ effectiveType: "4g", imageDurations: [3000, 3000, 3000, 3000] }),
    ).toBe(false);
  });

  it("elsewhere goes by the median of the first images", () => {
    expect(isSlowConnection({ imageDurations: [2400, 2100, 3000, 1900, 400] })).toBe(true);
    expect(isSlowConnection({ imageDurations: [300, 280, 4000, 350, 410] })).toBe(false);
  });

  it("says nothing slow on too few samples", () => {
    expect(isSlowConnection({ imageDurations: [5000, 5000, 5000] })).toBe(false);
  });
});

describe("slowLightboxSizes", () => {
  it("lands on the 1080 px candidate at every common pixel ratio", () => {
    for (const dpr of [1, 1.5, 2, 2.625, 3, 3.5]) {
      const css = Number.parseInt(slowLightboxSizes(dpr), 10);
      const wanted = css * dpr;
      const picked = DEVICE_SIZES.find((width) => width >= wanted);
      expect(picked).toBe(1080);
    }
  });
});
