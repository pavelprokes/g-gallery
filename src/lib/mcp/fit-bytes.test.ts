import { describe, expect, it, vi } from "vitest";
import { fitBytes } from "./fit-bytes";

const build = (output: { width: number; height: number }, quality: number) =>
  `https://cdn.test/${output.width}x${output.height}q${quality}`;

/** A JPEG whose size follows its pixels and quality, like a real one roughly does. */
const jpeg = (bytesPerPixelAt85: number) =>
  vi.fn(async (url: string) => {
    const [, w, h, q] = /(\d+)x(\d+)q(\d+)/.exec(url)!.map(Number) as number[];
    return Math.round(w! * h! * bytesPerPixelAt85 * (q! / 85) ** 2);
  });

describe("fitBytes", () => {
  it("asks once when the first size fits", async () => {
    const sizeOf = jpeg(0.2);
    const fitted = await fitBytes(build, { width: 1080, height: 1350 }, 85, 8_000_000, sizeOf);
    expect(fitted).toMatchObject({ quality: 85, fits: true, output: { width: 1080 } });
    expect(sizeOf).toHaveBeenCalledTimes(1);
  });

  it("starts below the pixel bound for a huge original", async () => {
    const sizeOf = jpeg(0.2);
    const fitted = await fitBytes(build, { width: 4692, height: 7035 }, 85, 8_000_000, sizeOf);
    expect(fitted.output.width * fitted.output.height).toBeLessThanOrEqual(16_000_000);
    expect(fitted.output.width / fitted.output.height).toBeCloseTo(4692 / 7035, 2);
    expect(fitted.fits).toBe(true);
  });

  it("lowers the quality first when the file is a little too big", async () => {
    const sizeOf = jpeg(1.2);
    const fitted = await fitBytes(build, { width: 2000, height: 2000 }, 85, 4_000_000, sizeOf);
    expect(fitted).toMatchObject({ fits: true, quality: 75, output: { width: 2000 } });
    expect(fitted.bytes).toBeLessThanOrEqual(4_000_000);
  });

  it("shrinks the size when it is far too big", async () => {
    const sizeOf = jpeg(2);
    const fitted = await fitBytes(build, { width: 2000, height: 2000 }, 85, 4_000_000, sizeOf);
    expect(fitted.fits).toBe(true);
    expect(fitted.quality).toBe(85);
    expect(fitted.output.width).toBeLessThan(2000);
    expect(fitted.output.width).toBe(fitted.output.height);
    expect(sizeOf).toHaveBeenCalledTimes(2);
  });

  it("reports a file that still does not fit after every step", async () => {
    const fitted = await fitBytes(
      build,
      { width: 1000, height: 1000 },
      85,
      50_000,
      async () => 10_000_000,
    );
    expect(fitted.fits).toBe(false);
  });

  it("says it could not measure instead of guessing", async () => {
    const fitted = await fitBytes(
      build,
      { width: 1080, height: 1350 },
      85,
      8_000_000,
      async () => null,
    );
    expect(fitted).toMatchObject({ bytes: null, fits: false, quality: 85 });
  });
});
