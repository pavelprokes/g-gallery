import { afterEach, describe, expect, it, vi } from "vitest";
import imageLoader from "./image-loader";
import { ALL_WIDTHS, DEVICE_SIZES, fullWidthSrcSet, IMAGE_SIZES, QUALITY } from "./image-sizes";

describe("variant budget", () => {
  it("keeps the width list short — each width is a billable transformation", () => {
    // Next.js defaults to 16 widths; at 500 photos × 20 galleries a year that
    // is the difference between comfortably inside the free allowance and not.
    expect(ALL_WIDTHS.length).toBeLessThanOrEqual(6);
  });

  it("offers exactly one quality", () => {
    expect(typeof QUALITY).toBe("number");
  });

  it("lists widths ascending with no duplicates", () => {
    expect([...ALL_WIDTHS]).toEqual([...ALL_WIDTHS].sort((a, b) => a - b));
    expect(new Set(ALL_WIDTHS).size).toBe(ALL_WIDTHS.length);
  });

  it("keeps thumbnail and full-width sets disjoint", () => {
    for (const size of IMAGE_SIZES) {
      expect(DEVICE_SIZES).not.toContain(size);
    }
  });
});

describe("fullWidthSrcSet", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("emits one candidate per device size, with descriptors", () => {
    vi.stubEnv("NEXT_PUBLIC_PHOTOS_BASE_URL", "https://photos.example.cz");
    const srcset = fullWidthSrcSet("galleries/a/1.jpg", imageLoader);
    const candidates = srcset.split(", ");

    expect(candidates).toHaveLength(DEVICE_SIZES.length);
    for (const [i, width] of DEVICE_SIZES.entries()) {
      expect(candidates[i]).toMatch(new RegExp(`${width}w$`));
    }
  });

  it("builds URLs through the same loader the <img> uses", () => {
    // If the preload and the <img> disagree, the browser warms a variant it
    // then ignores: the swipe still stalls and the transformation is billed twice.
    vi.stubEnv("NEXT_PUBLIC_PHOTOS_BASE_URL", "https://photos.example.cz");
    const width = DEVICE_SIZES[0]!;
    const expected = imageLoader({ src: "galleries/a/1.jpg", width, quality: QUALITY });
    expect(fullWidthSrcSet("galleries/a/1.jpg", imageLoader)).toContain(`${expected} ${width}w`);
  });

  it("uses the configured quality, not the loader default", () => {
    vi.stubEnv("NEXT_PUBLIC_PHOTOS_BASE_URL", "https://photos.example.cz");
    expect(fullWidthSrcSet("galleries/a/1.jpg", imageLoader)).toContain(`quality=${QUALITY}`);
  });

  it("follows the loader into imgproxy mode", () => {
    vi.stubEnv("NEXT_PUBLIC_PHOTOS_BASE_URL", "http://localhost:8080");
    vi.stubEnv("NEXT_PUBLIC_IMAGE_TRANSFORM", "imgproxy");
    expect(fullWidthSrcSet("galleries/a/1.jpg", imageLoader)).toContain("/insecure/rs:fit:");
  });
});
