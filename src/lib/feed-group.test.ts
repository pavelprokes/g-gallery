import { describe, expect, it } from "vitest";
import { groupFeed, MAX_THUMBS, type GroupableEntry } from "./feed-group";

const at = (minute: number) => new Date(Date.UTC(2026, 8, 27, 9, minute));
let n = 0;
const entry = (minute: number, over: Partial<GroupableEntry> = {}): GroupableEntry => ({
  id: `e${n++}`,
  type: "DOWNLOAD",
  createdAt: at(minute),
  galleryId: "g1",
  galleryTitle: "Alice a Martin",
  viewerId: "v1",
  viewerName: null,
  photoObjectKey: `k/${n}.jpg`,
  ...over,
});

describe("groupFeed", () => {
  it("folds one person's downloads from one sitting into a single row", () => {
    // Newest first, 9:14 down to 9:08 — the production screenshot's run.
    const groups = groupFeed([14, 13, 12, 12, 11, 10, 9, 8].map((m) => entry(m)));
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ count: 8, latest: at(14), earliest: at(8) });
    expect(groups[0]!.photos).toHaveLength(MAX_THUMBS);
  });

  it("splits on another person, another gallery, another action, or a long pause", () => {
    const groups = groupFeed([
      entry(50),
      entry(49, { viewerId: "v2" }),
      entry(48, { viewerId: "v2", galleryId: "g2" }),
      entry(47, { viewerId: "v2", galleryId: "g2", type: "FAVORITE" }),
      entry(10, { viewerId: "v2", galleryId: "g2", type: "FAVORITE" }), // 37 min gap
    ]);
    expect(groups.map((group) => group.count)).toEqual([1, 1, 1, 1, 1]);
  });

  it("measures the gap from the previous action, so a long steady sitting stays one row", () => {
    const minutes = [100, 80, 60, 40, 20, 0]; // 20 min apart, 100 min in total
    expect(groupFeed(minutes.map((m) => entry(m)))).toHaveLength(1);
  });

  it("never repeats a photo in the strip", () => {
    const groups = groupFeed([
      entry(3, { photoObjectKey: "a" }),
      entry(2, { photoObjectKey: "a" }),
    ]);
    expect(groups[0]!.photos).toEqual(["a"]);
  });
});
