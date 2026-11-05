import { describe, expect, it } from "vitest";
import {
  blurOnLastTwoPages,
  blurStyle,
  isThumbhash,
  thumbhashAverage,
  thumbhashDataUrl,
  thumbhashOfPixels,
} from "./thumbhash";

/** A w×h image: left half one colour, right half another. */
function halves(
  w: number,
  h: number,
  left: [number, number, number],
  right: [number, number, number],
) {
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = x < w / 2 ? left : right;
      rgba.set([r, g, b, 255], (y * w + x) * 4);
    }
  }
  return rgba;
}

describe("thumbhashOfPixels", () => {
  it("stores a photo in a few dozen characters that pass validation", () => {
    const hash = thumbhashOfPixels(100, 75, halves(100, 75, [200, 30, 30], [30, 30, 200]));
    expect(hash.length).toBeLessThanOrEqual(36);
    expect(isThumbhash(hash)).toBe(true);
  });

  it("keeps the true average, not a sample from the middle", () => {
    // Red on the left, blue on the right: the centre column is blue, the
    // average is the purple between them.
    const hash = thumbhashOfPixels(100, 50, halves(100, 50, [255, 0, 0], [0, 0, 255]));
    const average = thumbhashAverage(hash)!;
    const [r, , b] = [1, 3, 5].map((i) => parseInt(average.slice(i, i + 2), 16));
    expect(Math.abs(r! - b!)).toBeLessThan(40);
    expect(r).toBeGreaterThan(90);
  });
});

describe("isThumbhash", () => {
  it("refuses anything that could break out of a style or URL", () => {
    expect(isThumbhash('abc")url(x')).toBe(false);
    expect(isThumbhash("YJqGPQw7sFlslqhFafSE+Q6oJ1h2iHB2Rw;")).toBe(false);
    expect(isThumbhash("")).toBe(false);
    expect(isThumbhash("short")).toBe(false);
    expect(isThumbhash("A".repeat(80))).toBe(false);
  });

  it("refuses what no encoder writes: wrong length, or a shape of 0 px", () => {
    expect(isThumbhash("AAAAAAAA")).toBe(false);
    expect(isThumbhash("A".repeat(16))).toBe(false);
    expect(isThumbhash("A".repeat(40))).toBe(false);
    // Long enough, but a zero in the header's coefficient count.
    expect(isThumbhash("A".repeat(28))).toBe(false);
  });

  it("takes every shape the encoder can write, opaque or not", () => {
    // A guest's confirm is refused when this fails, so its bounds must hold
    // for the narrowest panorama as much as for a square with alpha.
    for (const [w, h] of [
      [1, 1],
      [100, 1],
      [1, 100],
      [100, 2],
      [100, 75],
      [75, 100],
      [100, 100],
    ] as const) {
      for (const alpha of [255, 128]) {
        const rgba = new Uint8Array(w * h * 4);
        for (let i = 0; i < rgba.length; i += 4) {
          rgba.set([(i * 7) % 255, (i * 13) % 255, (i * 29) % 255, i ? alpha : 255], i);
        }
        const hash = thumbhashOfPixels(w, h, rgba);
        expect(isThumbhash(hash), `${w}×${h}, alpha ${alpha}: ${hash}`).toBe(true);
      }
    }
  });
});

describe("thumbhashDataUrl", () => {
  it("draws a PNG data URL, and null for nothing or junk", () => {
    const hash = thumbhashOfPixels(40, 30, halves(40, 30, [10, 200, 10], [200, 200, 10]));
    expect(thumbhashDataUrl(hash)).toMatch(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/);
    expect(thumbhashDataUrl(null)).toBeNull();
    expect(thumbhashDataUrl("not a hash!")).toBeNull();
  });
});

describe("blurStyle", () => {
  it("lays the blur over the colour, stretched to the frame", () => {
    const hash = thumbhashOfPixels(40, 30, halves(40, 30, [10, 200, 10], [200, 200, 10]));
    const style = blurStyle(hash, "#123456");
    expect(style.backgroundColor).toBe("#123456");
    expect(style.backgroundImage).toMatch(/^url\("data:image\/png;base64,/);
    expect(style.backgroundSize).toBe("100% 100%");
  });

  it("is the colour alone without a hash", () => {
    expect(blurStyle(null, "#123456")).toEqual({ backgroundColor: "#123456" });
  });
});

describe("blurOnLastTwoPages", () => {
  const page = (ids: string[]) => ({
    items: ids.map((id) => ({ id, thumbhash: `hash-${id}` })),
    nextCursor: null,
  });

  it("leaves one or two pages alone", () => {
    const one = [page(["a", "b"])];
    expect(blurOnLastTwoPages(one)).toBe(one);
    const two = [page(["a"]), page(["b"])];
    expect(blurOnLastTwoPages(two)).toBe(two);
  });

  it("keeps the blur where the viewer lands, and the rows above it", () => {
    const result = blurOnLastTwoPages([page(["a"]), page(["b"]), page(["c"]), page(["d"])]);
    expect(result.map((p) => p.items[0]!.thumbhash)).toEqual([null, null, "hash-c", "hash-d"]);
  });
});
