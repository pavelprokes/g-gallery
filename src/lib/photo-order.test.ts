import { describe, expect, it } from "vitest";
import {
  afterPosition,
  beforePosition,
  chapterStartOf,
  compareChapterStarts,
  isValidOrderKey,
  orderKeyOf,
  photoOrderBy,
  photosOutOfPlace,
} from "./photo-order";

const photo = {
  takenAt: new Date("2026-09-05T08:07:33.880Z"),
  createdAt: new Date("2026-09-20T10:00:00.000Z"),
  fileOrderKey: "svatba0016p0015d0042738jpg",
  wovenAt: new Date("2026-09-05T09:00:00.000Z"),
};

describe("orderKeyOf", () => {
  it("is the capture time in capture-time order", () => {
    expect(orderKeyOf("TAKEN_AT", photo)).toBe("2026-09-05T08:07:33.880Z");
  });

  it("falls back to the upload time for a photo without one", () => {
    expect(orderKeyOf("TAKEN_AT", { ...photo, takenAt: null })).toBe("2026-09-20T10:00:00.000Z");
  });

  it("is the file-name key in file-name order", () => {
    expect(orderKeyOf("FILE_NAME", photo)).toBe(photo.fileOrderKey);
  });

  it("is the woven time with guests woven in, capture time before it is written", () => {
    expect(orderKeyOf("FILE_NAME_GUESTS_BY_TIME", photo)).toBe("2026-09-05T09:00:00.000Z");
    expect(orderKeyOf("FILE_NAME_GUESTS_BY_TIME", { ...photo, wovenAt: null })).toBe(
      "2026-09-05T08:07:33.880Z",
    );
  });
});

describe("queries", () => {
  it("orders by the order's own column, id as the tiebreaker", () => {
    expect(photoOrderBy("TAKEN_AT")).toEqual([{ takenAt: "asc" }, { id: "asc" }]);
    expect(photoOrderBy("FILE_NAME")).toEqual([{ fileOrderKey: "asc" }, { id: "asc" }]);
    expect(photoOrderBy("FILE_NAME_GUESTS_BY_TIME")).toEqual([{ wovenAt: "asc" }, { id: "asc" }]);
  });

  it("pages strictly after a position, in the order's own column", () => {
    expect(afterPosition("FILE_NAME", { key: "svatba", id: "p1" })).toEqual({
      OR: [{ fileOrderKey: { gt: "svatba" } }, { fileOrderKey: "svatba", id: { gt: "p1" } }],
    });
    const at = "2026-09-05T08:07:33.880Z";
    expect(afterPosition("TAKEN_AT", { key: at, id: "p1" })).toEqual({
      OR: [{ takenAt: { gt: new Date(at) } }, { takenAt: new Date(at), id: { gt: "p1" } }],
    });
    expect(afterPosition("FILE_NAME_GUESTS_BY_TIME", { key: at, id: "p1" })).toEqual({
      OR: [{ wovenAt: { gt: new Date(at) } }, { wovenAt: new Date(at), id: { gt: "p1" } }],
    });
  });

  it("counts strictly before a position", () => {
    expect(beforePosition("FILE_NAME", { key: "svatba", id: "p1" })).toEqual({
      OR: [{ fileOrderKey: { lt: "svatba" } }, { fileOrderKey: "svatba", id: { lt: "p1" } }],
    });
  });
});

describe("chapter starts", () => {
  const obrad = {
    startTakenAt: new Date("2026-09-05T11:00:00.000Z"),
    startFileOrderKey: "svatba0012jpg",
    startWovenAt: new Date("2026-09-05T12:30:00.000Z"),
    startPhotoId: "b",
  };
  const pripravy = {
    startTakenAt: new Date("2026-09-05T12:00:00.000Z"),
    startFileOrderKey: "svatba0011jpg",
    startWovenAt: null,
    startPhotoId: "a",
  };

  it("start on the same photo in either order, at that order's key", () => {
    expect(chapterStartOf("TAKEN_AT", obrad)).toEqual({ key: "2026-09-05T11:00:00.000Z", id: "b" });
    expect(chapterStartOf("FILE_NAME", obrad)).toEqual({ key: "svatba0012jpg", id: "b" });
    expect(chapterStartOf("FILE_NAME_GUESTS_BY_TIME", obrad)).toEqual({
      key: "2026-09-05T12:30:00.000Z",
      id: "b",
    });
    // Not woven yet: its capture time stands in.
    expect(chapterStartOf("FILE_NAME_GUESTS_BY_TIME", pripravy).key).toBe(
      "2026-09-05T12:00:00.000Z",
    );
  });

  it("sort by the gallery's order — the two orders can disagree", () => {
    expect([pripravy, obrad].toSorted(compareChapterStarts("TAKEN_AT"))).toEqual([obrad, pripravy]);
    expect([obrad, pripravy].toSorted(compareChapterStarts("FILE_NAME"))).toEqual([
      pripravy,
      obrad,
    ]);
  });
});

describe("isValidOrderKey", () => {
  it("accepts only what the database could have produced", () => {
    expect(isValidOrderKey("TAKEN_AT", "2026-09-05T08:07:33.880Z")).toBe(true);
    expect(isValidOrderKey("TAKEN_AT", "not-a-date")).toBe(false);
    expect(isValidOrderKey("FILE_NAME", "svatba0011jpg")).toBe(true);
    expect(isValidOrderKey("FILE_NAME", "")).toBe(true);
    expect(isValidOrderKey("FILE_NAME", "Svatba_01")).toBe(false);
    expect(isValidOrderKey("FILE_NAME", "a".repeat(1280))).toBe(true);
    expect(isValidOrderKey("FILE_NAME", "a".repeat(4097))).toBe(false);
    expect(isValidOrderKey("FILE_NAME_GUESTS_BY_TIME", "2026-09-05T08:07:33.880Z")).toBe(true);
    expect(isValidOrderKey("FILE_NAME_GUESTS_BY_TIME", "svatba0011jpg")).toBe(false);
  });
});

describe("photosOutOfPlace", () => {
  const byName = Array.from({ length: 16 }, (_, i) => `svatba_${i + 1}`);

  it("counts the one photo that moved, not the places it passed", () => {
    // Kamila a Petr, 2026-09-05: the second body's svatba_6 sorted second by time.
    const byTime = ["svatba_1", "svatba_6", ...byName.slice(1, 5), ...byName.slice(6)];
    expect(photosOutOfPlace(byTime, byName)).toBe(1);
  });

  it("is zero when the orders agree, and n - 1 when one is the other reversed", () => {
    expect(photosOutOfPlace(byName, byName)).toBe(0);
    expect(photosOutOfPlace(byName.toReversed(), byName)).toBe(15);
  });

  it("counts a whole camera an hour off as that camera's photos", () => {
    // Every third photo from a body whose clock put it an hour earlier.
    const early = byName.filter((_, i) => i % 3 === 2);
    const byTime = [...early, ...byName.filter((_, i) => i % 3 !== 2)];
    expect(photosOutOfPlace(byTime, byName)).toBe(early.length);
  });
});
