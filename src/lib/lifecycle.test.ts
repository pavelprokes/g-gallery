import { describe, expect, it } from "vitest";
import { selectColdGalleries } from "./lifecycle";

const NOW = new Date("2026-08-21T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

function gallery(over: Partial<Parameters<typeof selectColdGalleries>[0][number]> = {}) {
  return {
    id: "g1",
    title: "Svatba",
    publishedAt: new Date("2025-08-01T00:00:00Z"),
    lastActivityAt: null,
    photoIds: ["p1", "p2"],
    ...over,
  };
}

describe("selectColdGalleries", () => {
  it("tiers a gallery published well past the age cutoff", () => {
    const { cold } = selectColdGalleries([gallery()], NOW, 6);
    expect(cold.map((c) => c.galleryId)).toEqual(["g1"]);
    expect(cold[0]!.photoIds).toEqual(["p1", "p2"]);
  });

  it("leaves a recently published gallery alone", () => {
    const recent = gallery({ publishedAt: new Date("2026-07-01T00:00:00Z") });
    expect(selectColdGalleries([recent], NOW, 6).cold).toEqual([]);
  });

  it("never tiers an unpublished gallery — the clock starts at delivery", () => {
    expect(selectColdGalleries([gallery({ publishedAt: null })], NOW, 6).cold).toEqual([]);
  });

  it("spares a gallery viewed in the last 30 days despite its age", () => {
    // R2 bills a 30-day minimum for IA, so moving an object about to be read
    // again costs more than it saves.
    const active = gallery({ lastActivityAt: new Date(NOW.getTime() - 3 * DAY) });
    const { cold, skippedRecentlyViewed } = selectColdGalleries([active], NOW, 6);
    expect(cold).toEqual([]);
    expect(skippedRecentlyViewed).toBe(1);
  });

  it("tiers a gallery whose last view is older than the activity window", () => {
    const stale = gallery({ lastActivityAt: new Date(NOW.getTime() - 200 * DAY) });
    expect(selectColdGalleries([stale], NOW, 6).cold).toHaveLength(1);
  });

  it("skips a gallery with nothing left in STANDARD", () => {
    expect(selectColdGalleries([gallery({ photoIds: [] })], NOW, 6).cold).toEqual([]);
  });

  it("honours a configured age other than the default", () => {
    const g = gallery({ publishedAt: new Date("2026-06-01T00:00:00Z") });
    expect(selectColdGalleries([g], NOW, 6).cold).toEqual([]);
    expect(selectColdGalleries([g], NOW, 2).cold).toHaveLength(1);
  });

  it("separates cold from active across a mixed set", () => {
    const { cold, skippedRecentlyViewed } = selectColdGalleries(
      [
        gallery({ id: "old" }),
        gallery({ id: "fresh", publishedAt: new Date("2026-08-01T00:00:00Z") }),
        gallery({ id: "busy", lastActivityAt: new Date(NOW.getTime() - DAY) }),
      ],
      NOW,
      6,
    );
    expect(cold.map((c) => c.galleryId)).toEqual(["old"]);
    expect(skippedRecentlyViewed).toBe(1);
  });
});
