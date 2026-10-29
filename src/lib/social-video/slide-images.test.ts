import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SlideImages, type SlidePhoto } from "@/lib/social-video/slide-images";

// WebKit can empty a decoded bitmap: it then draws nothing, and a render left
// a black slide (Pavel's 30 s reel, 2026-10-29). Bitmaps and the 1×1 probe are
// faked: a "blank" image draws a transparent pixel, any other an opaque one.

interface Fake {
  width: number;
  height: number;
  blank: boolean | "black";
  close(): void;
}

const photo: SlidePhoto = {
  id: "p1",
  url: "https://cdn.example/p1.jpg",
  width: 3000,
  height: 2000,
};
let blankBitmaps: (boolean | "black")[];
let elementsBlank: boolean;
let bitmapsMade: number;

beforeEach(() => {
  bitmapsMade = 0;
  elementsBlank = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, blob: async () => new Blob(["jpeg"]) })),
  );
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async (): Promise<Fake> => {
      const blank = blankBitmaps[bitmapsMade++] ?? false;
      return { width: 1500, height: 1000, blank, close: () => {} };
    }),
  );
  // jsdom has no HTMLImageElement.decode.
  HTMLImageElement.prototype.decode = async function (this: HTMLImageElement) {
    (this as HTMLImageElement & { blank?: boolean }).blank = elementsBlank;
  };
  let drawn: { blank?: boolean | "black" } | null = null;
  const probe = {
    clearRect: () => {
      drawn = null;
    },
    drawImage: (image: { blank?: boolean | "black" }) => {
      drawn = image;
    },
    // 4×4 pixels: a photo's tones, nothing, or (`black`) opaque pure black.
    getImageData: () => ({
      data: Array.from({ length: 16 }, () =>
        !drawn || drawn.blank === true
          ? [0, 0, 0, 0]
          : drawn.blank === "black"
            ? [0, 0, 0, 255]
            : [90, 70, 60, 255],
      ).flat(),
    }),
  };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    probe as unknown as CanvasRenderingContext2D,
  );
  URL.createObjectURL = vi.fn(() => "blob:fake");
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  delete (HTMLImageElement.prototype as Partial<HTMLImageElement>).decode;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("SlideImages.ensureDrawn", () => {
  it("leaves a photo that draws as it is", async () => {
    blankBitmaps = [false];
    const store = new SlideImages();
    await store.ensureDrawn([photo]);
    expect(store.draws(photo.id)).toBe(true);
    expect(bitmapsMade).toBe(1);
  });

  it("decodes again a bitmap that draws nothing", async () => {
    blankBitmaps = [true, false];
    const store = new SlideImages();
    await store.keepOnly([photo]);
    expect(store.draws(photo.id)).toBe(false);
    await store.ensureDrawn([photo]);
    expect(store.draws(photo.id)).toBe(true);
    expect(bitmapsMade).toBe(2);
    // From the bytes already fetched.
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("falls back to an <img> when every bitmap comes out empty", async () => {
    blankBitmaps = [true, true, true];
    const store = new SlideImages();
    await store.ensureDrawn([photo]);
    expect(store.draws(photo.id)).toBe(true);
    expect(store.imageOf(photo.id)).toBeInstanceOf(HTMLImageElement);
  });

  it("fails rather than leave a black slide", async () => {
    blankBitmaps = [true, true, true];
    elementsBlank = true;
    const store = new SlideImages();
    await expect(store.ensureDrawn([photo])).rejects.toThrow("PHOTO_NOT_DRAWN");
  });

  it("decodes again a bitmap that comes out pure black, and keeps a photo that is black", async () => {
    blankBitmaps = ["black", false];
    const store = new SlideImages();
    await store.ensureDrawn([photo]);
    expect(store.draws(photo.id)).toBe(true);

    blankBitmaps = ["black", "black"];
    bitmapsMade = 0;
    elementsBlank = true;
    const dark = { ...photo, id: "p2" };
    // Every way gives black: a black photo, kept rather than failing the render.
    HTMLImageElement.prototype.decode = async function (this: HTMLImageElement) {
      (this as HTMLImageElement & { blank?: boolean | "black" }).blank = "black";
    };
    await expect(store.ensureDrawn([dark])).resolves.toBeUndefined();
  });

  it("repairs a photo once when asked again while it is being repaired", async () => {
    blankBitmaps = [true, false];
    const store = new SlideImages();
    await store.keepOnly([photo]);
    await Promise.all([store.ensureDrawn([photo]), store.ensureDrawn([photo])]);
    expect(bitmapsMade).toBe(2);
    expect(store.draws(photo.id)).toBe(true);
  });
});
