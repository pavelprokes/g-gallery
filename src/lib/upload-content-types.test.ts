import { describe, expect, it } from "vitest";
import { classifyContentType } from "./upload-content-types";

describe("classifyContentType", () => {
  it("maps every accepted type to its object-key extension", () => {
    expect(classifyContentType("image/jpeg")).toEqual({ ok: true, extension: ".jpg" });
    expect(classifyContentType("image/png")).toEqual({ ok: true, extension: ".png" });
    expect(classifyContentType("image/webp")).toEqual({ ok: true, extension: ".webp" });
    expect(classifyContentType("image/avif")).toEqual({ ok: true, extension: ".avif" });
  });

  it("normalises case and strips parameters", () => {
    expect(classifyContentType("IMAGE/JPEG")).toEqual({ ok: true, extension: ".jpg" });
    expect(classifyContentType("image/jpeg; charset=binary")).toEqual({
      ok: true,
      extension: ".jpg",
    });
  });

  it("calls out HEIC specifically — it is the iPhone default, not garbage input", () => {
    expect(classifyContentType("image/heic")).toEqual({ ok: false, reason: "heic" });
    expect(classifyContentType("image/heif")).toEqual({ ok: false, reason: "heic" });
  });

  it("calls out video separately, since guests pick it without noticing", () => {
    expect(classifyContentType("video/quicktime")).toEqual({ ok: false, reason: "video" });
    expect(classifyContentType("video/mp4")).toEqual({ ok: false, reason: "video" });
  });

  it("falls back to unsupported for anything else", () => {
    expect(classifyContentType("application/pdf")).toEqual({ ok: false, reason: "unsupported" });
    expect(classifyContentType("")).toEqual({ ok: false, reason: "unsupported" });
    expect(classifyContentType("image/gif")).toEqual({ ok: false, reason: "unsupported" });
  });
});
