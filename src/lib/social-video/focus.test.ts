import { describe, expect, it } from "vitest";
import { FOCUS_FROM, focusOf, type Focus } from "@/lib/social-video/focus";

/** RGBA pixels from a grey function. */
function image(width: number, height: number, grey: (x: number, y: number) => number) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = grey(x, y);
      rgba.set([v, v, v, 255], (y * width + x) * 4);
    }
  }
  return rgba;
}

/** focusOf on a photo drawn by `large` at twice `width` × `height`, as the face
 * worker hands it the photo at 512 px and, averaged down, at 256. */
function focusOfLarge(
  width: number,
  height: number,
  large: (x: number, y: number) => number,
): Focus | null {
  const big = image(width * 2, height * 2, large);
  const small = image(width, height, (x, y) => {
    let sum = 0;
    for (const [dx, dy] of [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ] as const) {
      sum += big[((2 * y + dy) * width * 2 + 2 * x + dx) * 4]!;
    }
    return Math.round(sum / 4);
  });
  return focusOf(
    { data: small, width, height },
    { data: big, width: width * 2, height: height * 2 },
  );
}

/** focusOf on a grey function drawn at `width` × `height`. */
function focusOfGrey(width: number, height: number, grey: (x: number, y: number) => number) {
  return focusOfLarge(width, height, (x, y) => grey(x >> 1, y >> 1));
}

/** A soft gradient everywhere, a checkerboard (crisp edges) inside the box. */
const detail =
  (box: { x0: number; y0: number; x1: number; y1: number }) => (x: number, y: number) =>
    x >= box.x0 && x < box.x1 && y >= box.y0 && y < box.y1
      ? ((x >> 1) + (y >> 1)) % 2
        ? 230
        : 30
      : 100 + Math.round((x + y) / 8);

describe("focusOf", () => {
  it("finds the sharp detail on a blurred photo", () => {
    // Shoes low on a portrait photo: x 64–128, y 220–300 of 192 × 256.
    const focus = focusOfGrey(192, 256, detail({ x0: 64, y0: 220, x1: 128, y1: 300 }));
    expect(focus).not.toBeNull();
    const cx = focus!.x + focus!.w / 2;
    const cy = focus!.y + focus!.h / 2;
    expect(cx).toBeGreaterThan(0.4);
    expect(cx).toBeLessThan(0.6);
    expect(cy).toBeGreaterThan(0.8);
    expect(focus!.strength).toBeGreaterThanOrEqual(FOCUS_FROM);
  });

  it("finds nothing when the whole photo is sharp", () => {
    expect(focusOfGrey(256, 170, detail({ x0: 0, y0: 0, x1: 256, y1: 170 }))).toBeNull();
  });

  it("finds nothing in a flat or tiny photo", () => {
    expect(focusOfGrey(256, 170, () => 128)).toBeNull();
    expect(focusOfGrey(10, 10, () => 128)).toBeNull();
  });

  it("keeps to the sharp spot it starts from, not the blur between two", () => {
    const two = (x: number, y: number) =>
      (x < 40 && y < 40) || (x >= 150 && y >= 130)
        ? ((x >> 1) + (y >> 1)) % 2
          ? 230
          : 30
        : 100 + Math.round((x + y) / 8);
    const focus = focusOfGrey(192, 170, two)!;
    expect(focus).not.toBeNull();
    // One of the two corners, not a box over both.
    expect(focus.w).toBeLessThan(0.5);
    expect(focus.h).toBeLessThan(0.5);
  });

  it("does not score a lone texture on black as endlessly strong", () => {
    const night = (x: number, y: number) =>
      x >= 100 && x < 130 && y >= 60 && y < 90 ? (((x >> 1) + (y >> 1)) % 2 ? 230 : 30) : 0;
    const focus = focusOfGrey(256, 170, night)!;
    expect(focus).not.toBeNull();
    expect(Number.isFinite(focus.strength)).toBe(true);
    expect(focus.strength).toBeLessThan(9999);
  });

  it("finds nothing when nothing is crisp", () => {
    const soft = (x: number, y: number) =>
      100 + Math.round(20 * Math.sin(x / 9) + 20 * Math.cos(y / 11));
    expect(focusOfGrey(256, 170, soft)).toBeNull();
  });

  it("aims at the crisp subject, not the bolder texture along the bottom", () => {
    // The rings on their cushion: a crisp pattern in the middle; baby's breath
    // across the bottom, finer and bolder — the sharpest at 256 px (where the
    // aim used to land) but a touch soft at 512.
    const rings = (x: number, y: number) =>
      x >= 200 && x < 312 && y >= 130 && y < 210 ? (((x >> 3) + (y >> 3)) % 2 ? 160 : 80) : 120;
    const soft = (x: number, y: number) => {
      let sum = 0;
      for (let d = -2; d <= 2; d++) sum += (((x + d) >> 2) + (y >> 2)) % 2 ? 250 : 5;
      return sum / 5;
    };
    const focus = focusOfLarge(256, 170, (x, y) => (y >= 280 ? soft(x, y) : rings(x, y)))!;
    expect(focus).not.toBeNull();
    const cy = focus.y + focus.h / 2;
    const cx = focus.x + focus.w / 2;
    expect(cy).toBeGreaterThan(0.35);
    expect(cy).toBeLessThan(0.65);
    expect(cx).toBeGreaterThan(0.35);
    expect(cx).toBeLessThan(0.65);
  });
});
