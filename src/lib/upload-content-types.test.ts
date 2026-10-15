import { describe, expect, it } from "vitest";
import { classifyContentType, type UploadCaller } from "./upload-content-types";

const CALLERS: UploadCaller[] = ["owner", "guest"];

describe("classifyContentType", () => {
  it.each(CALLERS)("maps every accepted image type to its object-key extension (%s)", (caller) => {
    expect(classifyContentType("image/jpeg", caller)).toEqual({
      ok: true,
      extension: ".jpg",
      kind: "PHOTO",
    });
    expect(classifyContentType("image/png", caller)).toEqual({
      ok: true,
      extension: ".png",
      kind: "PHOTO",
    });
    expect(classifyContentType("image/webp", caller)).toEqual({
      ok: true,
      extension: ".webp",
      kind: "PHOTO",
    });
    expect(classifyContentType("image/avif", caller)).toEqual({
      ok: true,
      extension: ".avif",
      kind: "PHOTO",
    });
  });

  it("normalises case and strips parameters", () => {
    expect(classifyContentType("IMAGE/JPEG", "guest")).toEqual({
      ok: true,
      extension: ".jpg",
      kind: "PHOTO",
    });
    expect(classifyContentType("image/jpeg; charset=binary", "guest")).toEqual({
      ok: true,
      extension: ".jpg",
      kind: "PHOTO",
    });
    expect(classifyContentType("VIDEO/MP4", "owner")).toEqual({
      ok: true,
      extension: ".mp4",
      kind: "VIDEO",
    });
  });

  it.each(CALLERS)(
    "calls out HEIC specifically — the iPhone default, not garbage (%s)",
    (caller) => {
      expect(classifyContentType("image/heic", caller)).toEqual({ ok: false, reason: "heic" });
      expect(classifyContentType("image/heif", caller)).toEqual({ ok: false, reason: "heic" });
    },
  );

  // docs/VIDEO.md §1: the split exists so opening video to the photographer
  // can never open it to guests too.
  it("never lets a guest upload video, whatever the container", () => {
    expect(classifyContentType("video/quicktime", "guest")).toEqual({ ok: false, reason: "video" });
    expect(classifyContentType("video/mp4", "guest")).toEqual({ ok: false, reason: "video" });
  });

  it("takes the photographer's MP4 as a video", () => {
    expect(classifyContentType("video/mp4", "owner")).toEqual({
      ok: true,
      extension: ".mp4",
      kind: "VIDEO",
    });
  });

  it("asks the photographer for an MP4 export instead of any other container", () => {
    expect(classifyContentType("video/quicktime", "owner")).toEqual({
      ok: false,
      reason: "video_format",
    });
    expect(classifyContentType("video/x-matroska", "owner")).toEqual({
      ok: false,
      reason: "video_format",
    });
  });

  it.each(CALLERS)("falls back to unsupported for anything else (%s)", (caller) => {
    expect(classifyContentType("application/pdf", caller)).toEqual({
      ok: false,
      reason: "unsupported",
    });
    expect(classifyContentType("", caller)).toEqual({ ok: false, reason: "unsupported" });
    expect(classifyContentType("image/gif", caller)).toEqual({ ok: false, reason: "unsupported" });
  });
});
