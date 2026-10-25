import { afterEach, describe, expect, it, vi } from "vitest";
import { mediaUrls, originalUrl } from "./media-urls";

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
