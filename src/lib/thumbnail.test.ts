import { describe, expect, it } from "vitest";
import { isThumbKey, THUMB_MAX_PX, thumbKeyFor, thumbSize } from "./thumbnail";

describe("thumbKeyFor", () => {
  it("sits beside the original, inside the same gallery prefix", () => {
    expect(thumbKeyFor("galleries/abc123/photo-1.jpg")).toBe("galleries/abc123/photo-1.thumb.webp");
  });

  it("handles every extension the upload path accepts", () => {
    for (const ext of ["jpg", "png", "webp", "avif"]) {
      expect(thumbKeyFor(`galleries/a/b.${ext}`)).toBe("galleries/a/b.thumb.webp");
    }
  });

  it("does not mistake a dot in a directory for an extension", () => {
    expect(thumbKeyFor("galleries/v1.2/photo")).toBe("galleries/v1.2/photo.thumb.webp");
  });

  it("round-trips with isThumbKey, and an original never looks like one", () => {
    expect(isThumbKey(thumbKeyFor("galleries/a/b.jpg"))).toBe(true);
    expect(isThumbKey("galleries/a/b.jpg")).toBe(false);
    expect(isThumbKey("galleries/a/b.webp")).toBe(false);
  });
});

describe("thumbSize", () => {
  it("bounds the long edge and keeps the aspect ratio", () => {
    expect(thumbSize(4000, 3000)).toEqual({ width: THUMB_MAX_PX, height: 384 });
    expect(thumbSize(3000, 4000)).toEqual({ width: 384, height: THUMB_MAX_PX });
  });

  it("never upscales — a small original would grow, not shrink", () => {
    expect(thumbSize(300, 200)).toEqual({ width: 300, height: 200 });
    expect(thumbSize(THUMB_MAX_PX, 100)).toEqual({ width: THUMB_MAX_PX, height: 100 });
  });

  it("never rounds a dimension down to zero on an extreme panorama", () => {
    const size = thumbSize(10000, 3);
    expect(size.width).toBe(THUMB_MAX_PX);
    expect(size.height).toBeGreaterThanOrEqual(1);
  });
});
