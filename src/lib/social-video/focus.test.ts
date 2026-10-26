import { describe, expect, it } from "vitest";
import { FOCUS_FROM, focusOf } from "@/lib/social-video/focus";

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
    const focus = focusOf(image(192, 256, detail({ x0: 64, y0: 220, x1: 128, y1: 300 })), 192, 256);
    expect(focus).not.toBeNull();
    const cx = focus!.x + focus!.w / 2;
    const cy = focus!.y + focus!.h / 2;
    expect(cx).toBeGreaterThan(0.4);
    expect(cx).toBeLessThan(0.6);
    expect(cy).toBeGreaterThan(0.8);
    expect(focus!.strength).toBeGreaterThanOrEqual(FOCUS_FROM);
  });

  it("finds nothing when the whole photo is sharp", () => {
    expect(
      focusOf(image(256, 170, detail({ x0: 0, y0: 0, x1: 256, y1: 170 })), 256, 170),
    ).toBeNull();
  });

  it("finds nothing in a flat or tiny photo", () => {
    expect(
      focusOf(
        image(256, 170, () => 128),
        256,
        170,
      ),
    ).toBeNull();
    expect(
      focusOf(
        image(10, 10, () => 128),
        10,
        10,
      ),
    ).toBeNull();
  });

  it("keeps to the sharp spot it starts from, not the blur between two", () => {
    const two = (x: number, y: number) =>
      (x < 40 && y < 40) || (x >= 150 && y >= 130)
        ? ((x >> 1) + (y >> 1)) % 2
          ? 230
          : 30
        : 100 + Math.round((x + y) / 8);
    const focus = focusOf(image(192, 170, two), 192, 170)!;
    expect(focus).not.toBeNull();
    // One of the two corners, not a box over both.
    expect(focus.w).toBeLessThan(0.5);
    expect(focus.h).toBeLessThan(0.5);
  });

  it("does not score a lone texture on black as endlessly strong", () => {
    const night = (x: number, y: number) =>
      x >= 100 && x < 130 && y >= 60 && y < 90 ? (((x >> 1) + (y >> 1)) % 2 ? 230 : 30) : 0;
    const focus = focusOf(image(256, 170, night), 256, 170)!;
    expect(focus).not.toBeNull();
    expect(Number.isFinite(focus.strength)).toBe(true);
    expect(focus.strength).toBeLessThan(9999);
  });

  it("finds nothing when nothing is crisp", () => {
    const soft = (x: number, y: number) =>
      100 + Math.round(20 * Math.sin(x / 9) + 20 * Math.cos(y / 11));
    expect(focusOf(image(256, 170, soft), 256, 170)).toBeNull();
  });
});
