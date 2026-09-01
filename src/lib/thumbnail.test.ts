import { describe, expect, it, vi } from "vitest";
import {
  isThumbKey,
  OWNER_THUMB_MAX_PX,
  THUMB_MAX_PX,
  THUMB_PROFILES,
  THUMB_RESIZE_OPTIONS,
  thumbKeyFor,
  thumbSize,
  type ThumbProfile,
} from "./thumbnail";
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

  it("still never upscales at the larger owner cap", () => {
    // The whole point of the owner profile is more pixels, but an 800 px
    // original must still not be blown up to 1024 — that would be a bigger
    // file than the thing it stands in for, and no sharper.
    expect(thumbSize(800, 600, OWNER_THUMB_MAX_PX)).toEqual({ width: 800, height: 600 });
    expect(thumbSize(4000, 3000, OWNER_THUMB_MAX_PX)).toEqual({
      width: OWNER_THUMB_MAX_PX,
      height: 768,
    });
  });
});

describe("thumbnail profiles", () => {
  it("gives the owner's desktop grid more pixels than the guest feed", () => {
    // A desktop tile is ~330 CSS px = 660 device px at 2×; 512 was upscaling.
    expect(THUMB_PROFILES.owner.maxPx).toBe(1024);
    expect(THUMB_PROFILES.guest.maxPx).toBe(THUMB_MAX_PX);
    expect(THUMB_PROFILES.owner.maxPx).toBeGreaterThan(THUMB_PROFILES.guest.maxPx);
  });

  it("pays for those pixels with quality, not bytes", () => {
    expect(THUMB_PROFILES.owner.webpQuality).toBe(0.65);
    expect(THUMB_PROFILES.guest.webpQuality).toBe(0.72);
    expect(THUMB_PROFILES.owner.webpQuality).toBeLessThan(THUMB_PROFILES.guest.webpQuality);
    // JPEG keeps its margin over WebP on both paths, or it rings.
    for (const profile of ["owner", "guest"] as const) {
      expect(THUMB_PROFILES[profile].jpegQuality).toBeGreaterThan(
        THUMB_PROFILES[profile].webpQuality,
      );
    }
  });

  it("leaves the guest path exactly where it was", () => {
    expect(THUMB_PROFILES.guest).toEqual({ maxPx: 512, webpQuality: 0.72, jpegQuality: 0.78 });
  });

  it("sharpens gently, inside pica's valid bands", () => {
    // mks2013 already sharpens, so the README's standalone 160 does not apply;
    // 60 is the top of the triangulated 40-80 band. Radius below 0.5 would
    // switch the unsharp mask off entirely, silently.
    expect(THUMB_RESIZE_OPTIONS.filter).toBe("mks2013");
    expect(THUMB_RESIZE_OPTIONS.unsharpAmount).toBeGreaterThanOrEqual(40);
    expect(THUMB_RESIZE_OPTIONS.unsharpAmount).toBeLessThanOrEqual(80);
    expect(THUMB_RESIZE_OPTIONS.unsharpRadius).toBeGreaterThanOrEqual(0.5);
    expect(THUMB_RESIZE_OPTIONS.unsharpRadius).toBeLessThanOrEqual(2);
    expect(THUMB_RESIZE_OPTIONS.unsharpThreshold).toBeGreaterThan(0);
    expect(THUMB_RESIZE_OPTIONS.unsharpThreshold).toBeLessThanOrEqual(255);
  });
});

/**
 * Drives the real `makeThumbnail` against a stubbed pica and a stubbed canvas
 * encoder — jsdom has neither `createImageBitmap` nor a working `toBlob`, and
 * what is worth asserting here is what gets handed to them.
 */
async function runMakeThumbnail(profile: ThumbProfile, width = 4000, height = 3000) {
  vi.resetModules();

  const resize = vi.fn(async (_from: unknown, to: HTMLCanvasElement) => to) as unknown as (
    ...args: unknown[]
  ) => Promise<HTMLCanvasElement>;
  vi.doMock("pica", () => ({ default: () => ({ resize }) }));

  const bitmap = { width, height, close: vi.fn() };
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => bitmap),
  );

  const encoded: { type: string; quality: number }[] = [];
  const toBlob = vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (
    callback: BlobCallback,
    type?: string,
    quality?: unknown,
  ) {
    encoded.push({ type: String(type), quality: Number(quality) });
    callback(new Blob(["thumb"], { type: String(type) }));
  });

  try {
    const { makeThumbnail } = await import("./thumbnail");
    const source = new Blob(["x".repeat(10_000)], { type: "image/jpeg" });
    const result = await makeThumbnail(source, profile);
    return { result, resize: resize as unknown as ReturnType<typeof vi.fn>, encoded, bitmap };
  } finally {
    toBlob.mockRestore();
    vi.unstubAllGlobals();
    vi.doUnmock("pica");
  }
}

describe("makeThumbnail", () => {
  it("resizes an owner upload to the 1024 px target", async () => {
    const { result, resize, encoded } = await runMakeThumbnail("owner");

    expect(result?.format).toBe("webp");
    const canvas = resize.mock.calls[0]![1] as HTMLCanvasElement;
    expect(canvas.width).toBe(1024);
    expect(canvas.height).toBe(768);
    expect(encoded[0]).toEqual({ type: "image/webp", quality: 0.65 });
  });

  it("leaves a guest upload at 512 px and its original quality", async () => {
    const { result, resize, encoded } = await runMakeThumbnail("guest");

    expect(result?.format).toBe("webp");
    const canvas = resize.mock.calls[0]![1] as HTMLCanvasElement;
    expect(canvas.width).toBe(THUMB_MAX_PX);
    expect(canvas.height).toBe(384);
    expect(encoded[0]).toEqual({ type: "image/webp", quality: 0.72 });
  });

  it("defaults to the guest profile, so an unannotated caller cannot inflate a phone upload", async () => {
    vi.resetModules();
    const resize = vi.fn(async (_from: unknown, to: HTMLCanvasElement) => to);
    vi.doMock("pica", () => ({ default: () => ({ resize }) }));
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({ width: 4000, height: 3000, close: vi.fn() })),
    );
    const toBlob = vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (
      callback: BlobCallback,
      type?: string,
    ) {
      callback(new Blob(["thumb"], { type: String(type) }));
    });

    try {
      const { makeThumbnail } = await import("./thumbnail");
      await makeThumbnail(new Blob(["x".repeat(10_000)], { type: "image/jpeg" }));
      expect((resize.mock.calls[0]![1] as HTMLCanvasElement).width).toBe(THUMB_MAX_PX);
    } finally {
      toBlob.mockRestore();
      vi.unstubAllGlobals();
      vi.doUnmock("pica");
    }
  });

  it("passes the sharpening options through to pica, on both paths", async () => {
    for (const profile of ["owner", "guest"] as const) {
      const { resize } = await runMakeThumbnail(profile);
      // Spread, not the frozen constant: pica must receive the values, and a
      // reference comparison would pass even if the object never reached it.
      expect(resize.mock.calls[0]![2]).toEqual({
        filter: "mks2013",
        unsharpAmount: 60,
        unsharpRadius: 0.6,
        unsharpThreshold: 2,
      });
    }
  });

  it("does not upscale a small original even on the owner path", async () => {
    const { resize } = await runMakeThumbnail("owner", 700, 500);
    const canvas = resize.mock.calls[0]![1] as HTMLCanvasElement;
    expect(canvas.width).toBe(700);
    expect(canvas.height).toBe(500);
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
