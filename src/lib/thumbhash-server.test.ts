import sharp from "sharp";
import { thumbHashToRGBA } from "thumbhash";
import { describe, expect, it } from "vitest";
import { thumbhashDataUrl, thumbhashOfPixels } from "./thumbhash";
import { thumbhashPngDataUrl } from "./thumbhash-server";

function gradient(w: number, h: number) {
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      rgba.set([(x * 255) / w, (y * 255) / h, 120, 255], (y * w + x) * 4);
    }
  }
  return rgba;
}

describe("thumbhashPngDataUrl", () => {
  const hash = thumbhashOfPixels(100, 67, gradient(100, 67));

  it("draws the very pixels the browser's decoder does", async () => {
    const url = thumbhashPngDataUrl(hash)!;
    const png = Buffer.from(url.replace(/^data:image\/png;base64,/, ""), "base64");
    const { data, info } = await sharp(png)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const expected = thumbHashToRGBA(Buffer.from(hash, "base64"));
    expect([info.width, info.height]).toEqual([expected.w, expected.h]);
    expect(Buffer.from(data).equals(Buffer.from(expected.rgba))).toBe(true);
  });

  it("is a fraction of the uncompressed one", () => {
    const compact = thumbhashPngDataUrl(hash)!;
    expect(compact.length).toBeLessThan(thumbhashDataUrl(hash)!.length / 2);
  });

  it("is a valid PNG or null for any value the check lets through", async () => {
    // Guests can store any string that passes `isThumbhash`, and this goes
    // straight into the HTML. A fixed seed: the same strings on every run.
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let seed = 42;
    const next = () => (seed = (seed * 1664525 + 1013904223) >>> 0) >>> 24;
    for (let run = 0; run < 400; run++) {
      const length = 20 + 4 * (next() % 5);
      const value = Array.from({ length }, () => alphabet[next() % 64]).join("");
      const url = thumbhashPngDataUrl(value);
      if (!url) continue;
      const png = Buffer.from(url.replace(/^data:image\/png;base64,/, ""), "base64");
      const { width, height } = await sharp(png).metadata();
      expect(width, value).toBeGreaterThan(0);
      expect(height, value).toBeGreaterThan(0);
    }
  });

  it("is null for nothing or junk", () => {
    expect(thumbhashPngDataUrl(null)).toBeNull();
    expect(thumbhashPngDataUrl('x")')).toBeNull();
    // Passes for base64, but would decode to a 0 px image.
    expect(thumbhashPngDataUrl("A".repeat(28))).toBeNull();
  });
});
