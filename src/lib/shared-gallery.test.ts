import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));

import { chapterCounts } from "@/lib/shared-gallery";

describe("chapterCounts", () => {
  const chapters = [{ id: "ceremony" }, { id: "party" }, { id: "empty" }];

  it("counts photos and videos apart, each chapter up to the next one's start", () => {
    // 100 items, 3 of them videos: the ceremony holds items 0–41 (2 videos),
    // the party 42–99 (1 video); the last chapter starts past the end.
    const counted = chapterCounts(
      chapters,
      { before: [0, 42, 100], total: 100 },
      { before: [0, 2, 3], total: 3 },
    );
    expect(counted).toEqual([
      { id: "ceremony", count: 42, videoCount: 2 },
      { id: "party", count: 58, videoCount: 1 },
    ]);
  });

  it("drops a chapter left with nothing in it", () => {
    const counted = chapterCounts(
      [{ id: "a" }, { id: "b" }],
      { before: [0, 0], total: 5 },
      { before: [0, 0], total: 0 },
    );
    expect(counted.map((chapter) => chapter.id)).toEqual(["b"]);
  });
});
