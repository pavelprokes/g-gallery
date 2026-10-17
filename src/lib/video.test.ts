import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadKeyOf, formatDuration, videoKeyFor, videoOf, videoSrc } from "./video";
import { thumbKeyFor } from "./thumbnail";

const POSTER = "galleries/abc/2956e1cf-4a03-4017-af00-6f81ddc28418.jpg";

describe("video keys", () => {
  it("puts the MP4 on the poster's stem, beside its thumbnail", () => {
    expect(videoKeyFor(POSTER)).toBe("galleries/abc/2956e1cf-4a03-4017-af00-6f81ddc28418.mp4");
    expect(thumbKeyFor(POSTER, "webp")).toBe(
      "galleries/abc/2956e1cf-4a03-4017-af00-6f81ddc28418.thumb.webp",
    );
  });

  it("downloads the film, never its poster", () => {
    expect(downloadKeyOf({ objectKey: POSTER, videoObjectKey: videoKeyFor(POSTER) })).toMatch(
      /\.mp4$/,
    );
    expect(downloadKeyOf({ objectKey: POSTER, videoObjectKey: null })).toBe(POSTER);
  });

  it("describes a video to the gallery, and a photo as nothing", () => {
    expect(videoOf({ videoObjectKey: "k.mp4", durationMs: 1000 })).toEqual({
      key: "k.mp4",
      durationMs: 1000,
    });
    expect(videoOf({ videoObjectKey: null, durationMs: null })).toBeNull();
  });
});

describe("formatDuration", () => {
  it("reads like a player's clock", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(42_400)).toBe("0:42");
    expect(formatDuration(169_748)).toBe("2:49");
    expect(formatDuration(3_723_000)).toBe("1:02:03");
  });
});

describe("videoSrc", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("serves from the bucket host in production", () => {
    vi.stubEnv("NEXT_PUBLIC_MEDIA_BASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_IMAGE_TRANSFORM", "cloudflare");
    vi.stubEnv("NEXT_PUBLIC_PHOTOS_BASE_URL", "https://cdn.example.cz/");
    expect(videoSrc("galleries/a b/x.mp4")).toBe("https://cdn.example.cz/galleries/a%20b/x.mp4");
  });

  it("prefers the media host when one is set", () => {
    vi.stubEnv("NEXT_PUBLIC_MEDIA_BASE_URL", "http://localhost:9000/g-gallery");
    vi.stubEnv("NEXT_PUBLIC_IMAGE_TRANSFORM", "imgproxy");
    expect(videoSrc("galleries/a/x.mp4")).toBe("http://localhost:9000/g-gallery/galleries/a/x.mp4");
  });

  it("has no URL behind imgproxy without one — imgproxy cannot stream an MP4", () => {
    vi.stubEnv("NEXT_PUBLIC_MEDIA_BASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_IMAGE_TRANSFORM", "imgproxy");
    vi.stubEnv("NEXT_PUBLIC_PHOTOS_BASE_URL", "http://localhost:8080");
    expect(videoSrc("galleries/a/x.mp4")).toBeNull();
  });
});
