import { describe, expect, it, vi } from "vitest";
import { isThumbKey, THUMB_MAX_PX, thumbKeyFor, thumbSize } from "./thumbnail";
import { withTimeout } from "./with-timeout";

describe("thumbKeyFor", () => {
  it("sits beside the original, inside the same gallery prefix", () => {
    expect(thumbKeyFor("galleries/abc123/photo-1.jpg", "webp")).toBe(
      "galleries/abc123/photo-1.thumb.webp",
    );
    expect(thumbKeyFor("galleries/abc123/photo-1.jpg", "jpeg")).toBe(
      "galleries/abc123/photo-1.thumb.jpg",
    );
  });

  it("handles every extension the upload path accepts", () => {
    for (const ext of ["jpg", "png", "webp", "avif"]) {
      expect(thumbKeyFor(`galleries/a/b.${ext}`, "webp")).toBe("galleries/a/b.thumb.webp");
    }
  });

  it("does not mistake a dot in a directory for an extension", () => {
    expect(thumbKeyFor("galleries/v1.2/photo", "webp")).toBe("galleries/v1.2/photo.thumb.webp");
  });

  it("gives the two formats different keys, so one never overwrites the other", () => {
    expect(thumbKeyFor("galleries/a/b.jpg", "webp")).not.toBe(
      thumbKeyFor("galleries/a/b.jpg", "jpeg"),
    );
  });

  it("round-trips with isThumbKey, and an original never looks like one", () => {
    expect(isThumbKey(thumbKeyFor("galleries/a/b.jpg", "webp"))).toBe(true);
    expect(isThumbKey(thumbKeyFor("galleries/a/b.jpg", "jpeg"))).toBe(true);
    expect(isThumbKey("galleries/a/b.jpg")).toBe(false);
    expect(isThumbKey("galleries/a/b.webp")).toBe(false);
  });
});

describe("thumbSize", () => {
  it("bounds the long edge and keeps the aspect ratio", () => {
    expect(thumbSize(4000, 3000)).toEqual({ width: THUMB_MAX_PX, height: 384 });
    expect(thumbSize(3000, 4000)).toEqual({ width: 384, height: THUMB_MAX_PX });
  });

  it("never upscales — a small original would grow, not shrink", () => {
    expect(thumbSize(300, 200)).toEqual({ width: 300, height: 200 });
    expect(thumbSize(THUMB_MAX_PX, 100)).toEqual({ width: THUMB_MAX_PX, height: 100 });
  });

  it("never rounds a dimension down to zero on an extreme panorama", () => {
    const size = thumbSize(10000, 3);
    expect(size.width).toBe(THUMB_MAX_PX);
    expect(size.height).toBeGreaterThanOrEqual(1);
  });
});

describe("withTimeout", () => {
  it("passes a value through when the work finishes in time", async () => {
    await expect(withTimeout(Promise.resolve("done"), 50, "work")).resolves.toBe("done");
  });

  it("rejects when the work never settles — the failure that actually hurts", async () => {
    // A worker that hangs is worse than one that throws: without this the
    // await never returns and the guest's upload sits there forever.
    const never = new Promise<string>(() => {});
    await expect(withTimeout(never, 10, "pica resize")).rejects.toThrow(/pica resize timed out/);
  });

  it("passes the original rejection through rather than masking it as a timeout", async () => {
    const failing = Promise.reject(new Error("worker exploded"));
    await expect(withTimeout(failing, 50, "work")).rejects.toThrow("worker exploded");
  });

  it("clears its timer on success — otherwise every photo would leave one pending", async () => {
    vi.useFakeTimers();
    try {
      const before = vi.getTimerCount();
      await withTimeout(Promise.resolve(1), 5_000, "work");
      expect(vi.getTimerCount()).toBe(before);
    } finally {
      vi.useRealTimers();
    }
  });
});
