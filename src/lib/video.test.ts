import { afterEach, describe, expect, it, vi } from "vitest";
import {
  downloadKeyOf,
  featuredFilmOf,
  formatDuration,
  mediaCounts,
  videoKeyFor,
  videoOf,
  videoSrc,
} from "./video";
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

describe("featuredFilmOf", () => {
  const row = {
    id: "v1",
    status: "CONFIRMED",
    objectKey: POSTER,
    placeholder: "#aabbcc",
    width: 1920,
    height: 1080,
    videoObjectKey: videoKeyFor(POSTER),
    durationMs: 222_000,
  };

  it("draws the card from the poster and plays the MP4", () => {
    expect(featuredFilmOf(row)).toEqual({
      id: "v1",
      objectKey: POSTER,
      placeholder: "#aabbcc",
      width: 1920,
      height: 1080,
      video: { key: videoKeyFor(POSTER), durationMs: 222_000 },
    });
  });

  it("drops a pointer that no longer names a playable film", () => {
    expect(featuredFilmOf(null)).toBeNull();
    expect(featuredFilmOf({ ...row, status: "PENDING" })).toBeNull();
    expect(featuredFilmOf({ ...row, videoObjectKey: null })).toBeNull();
  });
});

describe("mediaCounts", () => {
  const t = (key: "photoCount" | "videoCount", { count }: { count: number }) =>
    `${count} ${key === "photoCount" ? "photos" : "videos"}`;

  it("counts films apart, so a films-only gallery never says 'photo'", () => {
    expect(mediaCounts(t, 1, 1)).toEqual(["1 videos"]);
    expect(mediaCounts(t, 122, 2)).toEqual(["120 photos", "2 videos"]);
    expect(mediaCounts(t, 56, 0)).toEqual(["56 photos"]);
    expect(mediaCounts(t, 0, 0)).toEqual([]);
  });
});
