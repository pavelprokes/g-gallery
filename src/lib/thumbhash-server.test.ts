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

  it("is null for nothing or junk", () => {
    expect(thumbhashPngDataUrl(null)).toBeNull();
    expect(thumbhashPngDataUrl('x")')).toBeNull();
  });
});
