import { describe, expect, it } from "vitest";
import {
  blurOnLastPageOnly,
  blurStyle,
  isThumbhash,
  thumbhashAverage,
  thumbhashDataUrl,
  thumbhashOfPixels,
  thumbhashSize,
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

describe("thumbhashSize", () => {
  it("fits the long side into 100 px and keeps the shape", () => {
    expect(thumbhashSize(6000, 4000)).toEqual({ width: 100, height: 67 });
    expect(thumbhashSize(4000, 6000)).toEqual({ width: 67, height: 100 });
    expect(thumbhashSize(80, 20)).toEqual({ width: 80, height: 20 });
    expect(thumbhashSize(10_000, 10)).toEqual({ width: 100, height: 1 });
  });
});

describe("blurOnLastPageOnly", () => {
  const page = (ids: string[]) => ({
    items: ids.map((id) => ({ id, thumbhash: `hash-${id}` })),
    nextCursor: null,
  });

  it("leaves a single page alone", () => {
    const pages = [page(["a", "b"])];
    expect(blurOnLastPageOnly(pages)).toBe(pages);
  });

  it("keeps the blur only where the viewer lands", () => {
    const result = blurOnLastPageOnly([page(["a"]), page(["b"]), page(["c"])]);
    expect(result.map((p) => p.items[0]!.thumbhash)).toEqual([null, null, "hash-c"]);
  });
});
