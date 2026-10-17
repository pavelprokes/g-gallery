import { afterEach, describe, expect, it, vi } from "vitest";
import {
  displayKeyOf,
  durationParts,
  formatDuration,
  galleryVideoOf,
  posterKeyFor,
  videoUrlFor,
} from "./media";

afterEach(() => vi.unstubAllEnvs());

describe("displayKeyOf", () => {
  it("draws a photo as itself", () => {
    expect(displayKeyOf({ kind: "PHOTO", objectKey: "g/a/1.jpg", posterObjectKey: null })).toBe(
      "g/a/1.jpg",
    );
  });

  it("never hands a video's MP4 to an image surface", () => {
    const row = { kind: "VIDEO" as const, objectKey: "g/a/film.mp4", posterObjectKey: null };
    expect(displayKeyOf(row)).toBe(posterKeyFor("g/a/film.mp4"));
    expect(displayKeyOf(row)).not.toMatch(/\.mp4$/);
  });
});

describe("galleryVideoOf", () => {
  it("is null for a photo", () => {
    expect(
      galleryVideoOf({
        kind: "PHOTO",
        objectKey: "g/a/1.jpg",
        posterObjectKey: null,
        durationMs: null,
        sizeBytes: 10,
      }),
    ).toBeNull();
  });

  it("plays a video straight from the delivery host, with no transform", () => {
    vi.stubEnv("NEXT_PUBLIC_PHOTOS_BASE_URL", "https://cdn.example.com/");
    const video = galleryVideoOf({
      kind: "VIDEO",
      objectKey: "galleries/x y/film.mp4",
      posterObjectKey: "galleries/x y/film.poster.jpg",
      durationMs: 102_000,
      sizeBytes: 400_000_000,
    });
    expect(video).toEqual({
      url: "https://cdn.example.com/galleries/x%20y/film.mp4",
      durationMs: 102_000,
      sizeBytes: 400_000_000,
    });
    expect(video?.url).not.toContain("cdn-cgi");
  });
});

describe("videoUrlFor", () => {
  it("falls back to a root-relative path without a delivery host", () => {
    vi.stubEnv("NEXT_PUBLIC_PHOTOS_BASE_URL", "");
    expect(videoUrlFor("g/a/film.mp4")).toBe("/g/a/film.mp4");
  });
});

describe("durations", () => {
  it("formats the tile chip", () => {
    expect(formatDuration(102_000)).toBe("1:42");
    expect(formatDuration(3_729_000)).toBe("1:02:09");
  });

  it("splits for the spoken label", () => {
    expect(durationParts(102_400)).toEqual({ minutes: 1, seconds: 42 });
  });
});
