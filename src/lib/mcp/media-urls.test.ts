import { afterEach, describe, expect, it, vi } from "vitest";
import { croppedUrl, mediaUrls, originalUrl, type CropSpec } from "./media-urls";

const PHOTO = {
  objectKey: "galleries/abc/1f2e.jpg",
  thumbObjectKey: "galleries/abc/1f2e.thumb.webp",
  videoObjectKey: null,
};

afterEach(() => vi.unstubAllEnvs());

describe("mediaUrls", () => {
  it("uses the loader's Cloudflare variants and the bucket's own object for the original", () => {
    vi.stubEnv("NEXT_PUBLIC_PHOTOS_BASE_URL", "https://cdn.example.test/");
    vi.stubEnv("NEXT_PUBLIC_IMAGE_TRANSFORM", "cloudflare");
    expect(mediaUrls(PHOTO)).toEqual({
      thumbUrl: "https://cdn.example.test/galleries/abc/1f2e.thumb.webp",
      previewUrl:
        "https://cdn.example.test/cdn-cgi/image/width=1920,quality=82,format=auto,fit=scale-down/galleries/abc/1f2e.jpg",
      originalUrl: "https://cdn.example.test/galleries/abc/1f2e.jpg",
    });
  });

  it("falls back to a 384 px transformation when the browser made no thumbnail", () => {
    vi.stubEnv("NEXT_PUBLIC_PHOTOS_BASE_URL", "https://cdn.example.test");
    expect(mediaUrls({ ...PHOTO, thumbObjectKey: null }).thumbUrl).toBe(
      "https://cdn.example.test/cdn-cgi/image/width=384,quality=82,format=auto,fit=scale-down/galleries/abc/1f2e.jpg",
    );
  });

  it("serves a video's MP4 straight from the media host", () => {
    vi.stubEnv("NEXT_PUBLIC_PHOTOS_BASE_URL", "https://cdn.example.test");
    vi.stubEnv("NEXT_PUBLIC_MEDIA_BASE_URL", "https://media.example.test");
    expect(mediaUrls({ ...PHOTO, videoObjectKey: "galleries/abc/1f2e.mp4" }).videoUrl).toBe(
      "https://media.example.test/galleries/abc/1f2e.mp4",
    );
  });

  it("goes through imgproxy locally, the original included", () => {
    vi.stubEnv("NEXT_PUBLIC_PHOTOS_BASE_URL", "http://localhost:8080");
    vi.stubEnv("NEXT_PUBLIC_IMAGE_TRANSFORM", "imgproxy");
    expect(mediaUrls(PHOTO)).toMatchObject({
      thumbUrl:
        "http://localhost:8080/insecure/rs:fit:384:0/q:82/plain/galleries/abc/1f2e.thumb.webp",
      originalUrl: "http://localhost:8080/insecure/plain/galleries/abc/1f2e.jpg",
    });
  });

  it("serves the thumbnail object itself when nothing transforms", () => {
    vi.stubEnv("NEXT_PUBLIC_PHOTOS_BASE_URL", "https://bucket.example.test");
    vi.stubEnv("NEXT_PUBLIC_IMAGE_TRANSFORM", "none");
    expect(mediaUrls(PHOTO)).toMatchObject({
      thumbUrl: "https://bucket.example.test/galleries/abc/1f2e.thumb.webp",
      originalUrl: "https://bucket.example.test/galleries/abc/1f2e.jpg",
    });
  });

  it("has no address without a delivery host", () => {
    vi.stubEnv("NEXT_PUBLIC_PHOTOS_BASE_URL", "");
    expect(originalUrl(PHOTO.objectKey)).toBeNull();
    expect(mediaUrls(PHOTO).previewUrl).toBeNull();
  });
});

describe("croppedUrl", () => {
  const SPEC: CropSpec = {
    width: 4692,
    height: 7035,
    rect: { x: 1000, y: 1000, w: 3000, h: 3750 },
    output: { width: 1080, height: 1350 },
    format: "jpeg",
    quality: 85,
  };

  it("trims the rectangle off the original on Cloudflare, then sizes it exactly", () => {
    vi.stubEnv("NEXT_PUBLIC_PHOTOS_BASE_URL", "https://cdn.example.test");
    expect(croppedUrl(PHOTO.objectKey, SPEC)).toBe(
      "https://cdn.example.test/cdn-cgi/image/trim=1000;692;2285;1000,width=1080,height=1350,fit=cover,quality=85,format=jpeg/galleries/abc/1f2e.jpg",
    );
    const whole = { ...SPEC, rect: { x: 0, y: 0, w: 4692, h: 7035 }, format: "webp" as const };
    expect(croppedUrl(PHOTO.objectKey, whole)).toBe(
      "https://cdn.example.test/cdn-cgi/image/width=1080,height=1350,fit=cover,quality=85,format=webp/galleries/abc/1f2e.jpg",
    );
  });

  it("crops at an offset through imgproxy locally", () => {
    vi.stubEnv("NEXT_PUBLIC_PHOTOS_BASE_URL", "http://localhost:8080");
    vi.stubEnv("NEXT_PUBLIC_IMAGE_TRANSFORM", "imgproxy");
    expect(croppedUrl(PHOTO.objectKey, SPEC)).toBe(
      "http://localhost:8080/insecure/crop:3000:3750:nowe:1000:1000/rs:fit:1080:1350:0/q:85/f:jpg/plain/galleries/abc/1f2e.jpg",
    );
  });

  it("has nothing to offer without a transform backend", () => {
    vi.stubEnv("NEXT_PUBLIC_PHOTOS_BASE_URL", "https://bucket.example.test");
    vi.stubEnv("NEXT_PUBLIC_IMAGE_TRANSFORM", "none");
    expect(croppedUrl(PHOTO.objectKey, SPEC)).toBeNull();
  });
});
