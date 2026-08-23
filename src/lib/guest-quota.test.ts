import { describe, expect, it } from "vitest";
import {
  GUEST_MAX_FILES_PER_GALLERY,
  GUEST_MAX_FILES_PER_VIEWER,
  checkGuestQuota,
} from "./guest-quota";

describe("checkGuestQuota", () => {
  it("allows a batch that fits under both ceilings", () => {
    expect(checkGuestQuota({ galleryUsed: 10, viewerUsed: 2, requested: 8 })).toEqual({
      ok: true,
      remaining: GUEST_MAX_FILES_PER_VIEWER - 2,
    });
  });

  it("allows a batch that exactly reaches the viewer ceiling", () => {
    const verdict = checkGuestQuota({
      galleryUsed: 0,
      viewerUsed: GUEST_MAX_FILES_PER_VIEWER - 3,
      requested: 3,
    });
    expect(verdict.ok).toBe(true);
    expect(verdict.remaining).toBe(3);
  });

  it("refuses one file past the viewer ceiling and names the viewer cap", () => {
    const verdict = checkGuestQuota({
      galleryUsed: 0,
      viewerUsed: GUEST_MAX_FILES_PER_VIEWER,
      requested: 1,
    });
    expect(verdict).toEqual({ ok: false, reason: "VIEWER_FULL", remaining: 0 });
  });

  it("names the gallery cap when that is the tighter one", () => {
    const verdict = checkGuestQuota({
      galleryUsed: GUEST_MAX_FILES_PER_GALLERY - 1,
      viewerUsed: 0,
      requested: 5,
    });
    expect(verdict).toEqual({ ok: false, reason: "GALLERY_FULL", remaining: 1 });
  });

  it("prefers the gallery cap when both are equally tight — the one nothing can reset", () => {
    const verdict = checkGuestQuota({
      galleryUsed: 8,
      viewerUsed: 8,
      requested: 5,
      perGallery: 10,
      perViewer: 10,
    });
    expect(verdict).toEqual({ ok: false, reason: "GALLERY_FULL", remaining: 2 });
  });

  it("never reports negative headroom once a cap was lowered under existing rows", () => {
    const verdict = checkGuestQuota({
      galleryUsed: 50,
      viewerUsed: 0,
      requested: 1,
      perGallery: 10,
    });
    expect(verdict.remaining).toBe(0);
    expect(verdict.ok).toBe(false);
  });

  it("treats a zero-file request as allowed rather than as a cap breach", () => {
    expect(
      checkGuestQuota({ galleryUsed: 999, viewerUsed: 999, requested: 0, perGallery: 10 }).ok,
    ).toBe(true);
  });
});
