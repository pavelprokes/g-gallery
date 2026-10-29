import { describe, expect, it, vi } from "vitest";
import { clipSource, drawClipped } from "@/lib/social-video/draw-clipped";

const image = { width: 3072, height: 2048 };
const frame = { x: 0, y: 0, w: 1080, h: 1920 };

describe("clipSource", () => {
  it("leaves a source on the image as it is", () => {
    const from = { x: 100, y: 0, w: 1152, h: 2048 };
    expect(clipSource(image, from, frame)).toEqual({ from, to: frame });
  });

  it("trims a full-height frame a transform's rounding pushed past the bottom", () => {
    // 2049 px asked of a bitmap 2048 high — WebKit drew the whole slide black.
    const clipped = clipSource(image, { x: 100, y: 0, w: 1152.5625, h: 2049 }, frame)!;
    expect(clipped.from.y + clipped.from.h).toBe(2048);
    expect(clipped.to.h).toBeCloseTo(1920 * (2048 / 2049));
    expect(clipped.to.y).toBe(0);
  });

  it("moves the destination as far as a source before the edge is cut off", () => {
    // A face scan's window half off the photo's left edge.
    const clipped = clipSource(
      image,
      { x: -100, y: 50, w: 400, h: 400 },
      { x: 0, y: 0, w: 320, h: 320 },
    )!;
    expect(clipped.from).toEqual({ x: 0, y: 50, w: 300, h: 400 });
    expect(clipped.to).toEqual({ x: 80, y: 0, w: 240, h: 320 });
  });

  it("gives nothing for a source off the image", () => {
    expect(clipSource(image, { x: 4000, y: 0, w: 100, h: 100 }, frame)).toBeNull();
    expect(clipSource(image, { x: 0, y: 0, w: 0, h: 100 }, frame)).toBeNull();
  });
});

describe("drawClipped", () => {
  it("draws the clipped source, and nothing when none is on the image", () => {
    const ctx = { drawImage: vi.fn() };
    const bitmap = image as unknown as CanvasImageSource & typeof image;
    drawClipped(ctx, bitmap, { x: -0.5, y: 0, w: 1152, h: 2048.3 }, frame);
    const [, sx, sy, sw, sh] = ctx.drawImage.mock.calls[0]!;
    expect([sx, sy]).toEqual([0, 0]);
    expect(sx + sw).toBeLessThanOrEqual(3072);
    expect(sy + sh).toBeLessThanOrEqual(2048);
    drawClipped(ctx, bitmap, { x: 5000, y: 0, w: 10, h: 10 }, frame);
    expect(ctx.drawImage).toHaveBeenCalledTimes(1);
  });
});
