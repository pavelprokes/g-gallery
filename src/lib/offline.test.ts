import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { estimateBytes, formatBytes, offlineUrls, widthsForThisDevice } from "./offline";
import { DEVICE_SIZES, IMAGE_SIZES } from "./image-sizes";

function setViewport(width: number, dpr: number) {
  vi.stubGlobal("window", { ...globalThis.window, innerWidth: width, devicePixelRatio: dpr });
}

describe("widthsForThisDevice", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("picks a small grid variant on a phone", () => {
    setViewport(390, 3); // iPhone-ish
    const { grid } = widthsForThisDevice();
    // 390/2 × 3 = 585, so the first candidate at or above that.
    expect(grid).toBe(640);
  });

  it("picks the full-width variant the lightbox will request", () => {
    // 390 CSS px at DPR 3 needs 1170 device px, so the browser takes 1920 —
    // not 1080. Getting this wrong would cache a variant nothing displays.
    setViewport(390, 3);
    expect(widthsForThisDevice().full).toBe(1920);
  });

  it("caps at the largest offered width rather than inventing one", () => {
    // A 6K display asks for more than we generate; it must reuse the top size,
    // not request a variant that would be a new billable transformation.
    setViewport(6016, 2);
    expect(widthsForThisDevice().full).toBe(DEVICE_SIZES[DEVICE_SIZES.length - 1]);
  });

  it("only ever returns widths we actually generate", () => {
    const offered = new Set<number>([...IMAGE_SIZES, ...DEVICE_SIZES]);
    for (const [w, dpr] of [
      [320, 1],
      [390, 3],
      [768, 2],
      [1440, 1],
      [2560, 2],
    ] as const) {
      setViewport(w, dpr);
      const { grid, full } = widthsForThisDevice();
      expect(offered.has(grid)).toBe(true);
      expect(offered.has(full)).toBe(true);
    }
  });
});

describe("offlineUrls", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_PHOTOS_BASE_URL", "https://photos.example.cz");
    setViewport(390, 3);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("keeps two variants per photo, plus the page", () => {
    // Caching all five widths would multiply the download and the billed
    // transformations by five, and four would never be shown on this device.
    const urls = offlineUrls(["a/1.jpg", "a/2.jpg"], "https://app/g/tok");
    expect(urls).toHaveLength(2 * 2 + 1);
    expect(urls).toContain("https://app/g/tok");
  });

  it("deduplicates when the grid and full widths coincide", () => {
    setViewport(2000, 1); // grid target 1000 -> 1080; full target 2000 -> 2560
    const urls = offlineUrls(["a/1.jpg"], "p");
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("produces no duplicate entries for repeated keys", () => {
    const urls = offlineUrls(["a/1.jpg", "a/1.jpg"], "p");
    expect(new Set(urls).size).toBe(urls.length);
  });
});

describe("estimateBytes", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("stays far below the cost of the originals", () => {
    // 500 originals is about 8 GB; the whole point is that offline costs a
    // fraction of that.
    setViewport(390, 3);
    expect(estimateBytes(500)).toBeLessThan(500 * 1024 ** 2);
  });

  it("depends on the screen, because the cached variant does", () => {
    setViewport(1440, 1); // desktop: grid 768->1080, full 1440->1920
    const desktop = estimateBytes(100);
    setViewport(390, 3); // phone: grid 585->640, full 1170->1920
    const phone = estimateBytes(100);
    expect(desktop).not.toBe(phone);
  });

  it("is zero for an empty gallery", () => {
    setViewport(390, 3);
    expect(estimateBytes(0)).toBe(0);
  });
});

describe("formatBytes", () => {
  it("uses units a person can act on", () => {
    expect(formatBytes(84 * 1024 ** 2)).toBe("84 MB");
    expect(formatBytes(2.5 * 1024 ** 3)).toBe("2.5 GB");
    expect(formatBytes(4096)).toBe("4 kB");
  });

  it("never shows 0 kB for something that exists", () => {
    expect(formatBytes(120)).toBe("1 kB");
  });
});
