import { describe, expect, it } from "vitest";
import {
  clampPan,
  clampScale,
  containedSize,
  distance,
  DOUBLE_TAP_SCALE,
  isZoomed,
  MAX_SCALE,
  midpoint,
  panBounds,
  zoomAround,
} from "./zoom-pan";

const LANDSCAPE = 3 / 2;
const PORTRAIT = 2 / 3;
const SCREEN = { width: 400, height: 800 };

describe("containedSize", () => {
  it("fits a landscape photo to the container's width", () => {
    expect(containedSize(SCREEN, LANDSCAPE)).toEqual({ width: 400, height: 400 / LANDSCAPE });
  });

  it("fits a portrait photo to whichever side runs out first", () => {
    // 2:3 on a 400x800 screen still runs out of width before height.
    expect(containedSize(SCREEN, PORTRAIT)).toEqual({ width: 400, height: 400 / PORTRAIT });
    // Taller than the screen's own 1:2, so now the height is the limit.
    expect(containedSize(SCREEN, 1 / 4)).toEqual({ width: 200, height: 800 });
  });

  it("returns nothing for a container or aspect that isn't measurable yet", () => {
    expect(containedSize({ width: 0, height: 0 }, LANDSCAPE)).toEqual({ width: 0, height: 0 });
    expect(containedSize(SCREEN, 0)).toEqual({ width: 0, height: 0 });
    expect(containedSize(SCREEN, Number.NaN)).toEqual({ width: 0, height: 0 });
  });
});

describe("clampScale", () => {
  it("never zooms out past the fitted photo", () => {
    expect(clampScale(0.4)).toBe(1);
  });

  it("stops at the maximum", () => {
    expect(clampScale(99)).toBe(MAX_SCALE);
  });

  it("falls back to fitted for a degenerate pinch rather than propagating it", () => {
    expect(clampScale(Number.NaN)).toBe(1);
    expect(clampScale(Number.POSITIVE_INFINITY)).toBe(1);
  });
});

describe("isZoomed", () => {
  it("ignores the float dust a pinch leaves behind", () => {
    expect(isZoomed(1)).toBe(false);
    expect(isZoomed(1.005)).toBe(false);
    expect(isZoomed(DOUBLE_TAP_SCALE)).toBe(true);
  });
});

describe("panBounds", () => {
  it("allows no travel while the photo is fitted", () => {
    expect(panBounds(SCREEN, LANDSCAPE, 1)).toEqual({ width: 0, height: 0 });
  });

  it("only allows travel on the axis the photo overflows", () => {
    // A landscape photo on a tall screen: at 2x it is 800 wide (400 over) and
    // 533 tall (still inside 800), so it may slide sideways but not upward.
    const bounds = panBounds(SCREEN, LANDSCAPE, 2);
    expect(bounds.width).toBe(200);
    expect(bounds.height).toBe(0);
  });

  it("grows with the scale", () => {
    // Fitted at 400x600, so 3x is 1800 tall against an 800 frame.
    expect(panBounds(SCREEN, PORTRAIT, 3).height).toBe(500);
    expect(panBounds(SCREEN, PORTRAIT, 2).height).toBe(200);
  });
});

describe("clampPan", () => {
  it("holds the photo's edge at the frame", () => {
    const pan = clampPan({ x: 9999, y: 9999 }, SCREEN, LANDSCAPE, 2);
    expect(pan).toEqual({ x: 200, y: 0 });
  });

  it("leaves an in-bounds pan alone", () => {
    expect(clampPan({ x: -50, y: 0 }, SCREEN, LANDSCAPE, 2)).toEqual({ x: -50, y: 0 });
  });

  it("recentres when the scale drops back to fitted", () => {
    const pan = clampPan({ x: -180, y: 40 }, SCREEN, LANDSCAPE, 1);
    expect(pan.x).toBeCloseTo(0);
    expect(pan.y).toBeCloseTo(0);
  });
});

describe("zoomAround", () => {
  it("keeps the centre still when zooming from the centre", () => {
    expect(zoomAround({ x: 0, y: 0 }, { x: 0, y: 0 }, 1, 2)).toEqual({ x: 0, y: 0 });
  });

  it("keeps the focused point under the fingers", () => {
    const focus = { x: 100, y: -40 };
    const from = 1;
    const to = 2.5;
    const pan = zoomAround(focus, { x: 0, y: 0 }, from, to);

    // The image point under `focus` is unchanged by the zoom, which is the
    // whole contract: (focus - pan) / scale before and after.
    const before = { x: (focus.x - 0) / from, y: (focus.y - 0) / from };
    const after = { x: (focus.x - pan.x) / to, y: (focus.y - pan.y) / to };
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it("is reversible", () => {
    const focus = { x: 30, y: 70 };
    const zoomedIn = zoomAround(focus, { x: 0, y: 0 }, 1, 3);
    const backOut = zoomAround(focus, zoomedIn, 3, 1);
    expect(backOut.x).toBeCloseTo(0);
    expect(backOut.y).toBeCloseTo(0);
  });

  it("refuses to divide by a zero scale", () => {
    expect(zoomAround({ x: 1, y: 1 }, { x: 5, y: 5 }, 0, 2)).toEqual({ x: 5, y: 5 });
  });
});

describe("distance / midpoint", () => {
  it("reads a pinch off two pointers", () => {
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
    expect(midpoint({ x: 0, y: 0 }, { x: 10, y: 4 })).toEqual({ x: 5, y: 2 });
  });
});
