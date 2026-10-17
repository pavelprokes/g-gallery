import { describe, expect, it } from "vitest";
import type { Mp4Facts } from "./mp4-inspect";
import { problemIn } from "./video-prepare";

const clean: Mp4Facts = {
  createdAt: null,
  hasLocation: false,
  videoCodec: "avc1",
  videoWidth: 1920,
  videoHeight: 1080,
};

describe("problemIn", () => {
  it("passes a clean H.264 export at any resolution up to 4K, either orientation", () => {
    expect(problemIn(clean)).toBeNull();
    expect(problemIn({ ...clean, videoWidth: 3840, videoHeight: 2160 })).toBeNull();
    expect(problemIn({ ...clean, videoWidth: 4096, videoHeight: 2160 })).toBeNull();
    expect(problemIn({ ...clean, videoWidth: 2160, videoHeight: 3840 })).toBeNull();
  });

  it("refuses anything past 4K on the long edge — the limit is resolution, not size", () => {
    expect(problemIn({ ...clean, videoWidth: 5120, videoHeight: 2880 })).toBe("video_resolution");
    expect(problemIn({ ...clean, videoWidth: 2880, videoHeight: 5120 })).toBe("video_resolution");
  });

  it("puts location before codec before resolution", () => {
    expect(problemIn({ ...clean, hasLocation: true, videoCodec: "hvc1" })).toBe("video_location");
    expect(problemIn({ ...clean, videoCodec: "hvc1", videoWidth: 7680, videoHeight: 4320 })).toBe(
      "video_codec",
    );
  });

  it("refuses a file whose header cannot be read — no location check, no upload", () => {
    expect(problemIn(null)).toBe("video_unreadable");
  });

  it("leaves a readable header with no recognised video track to the decoder", () => {
    expect(
      problemIn({ ...clean, videoCodec: null, videoWidth: null, videoHeight: null }),
    ).toBeNull();
  });
});
