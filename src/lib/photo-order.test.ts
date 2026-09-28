import { describe, expect, it } from "vitest";
import {
  afterPosition,
  beforePosition,
  chapterStartOf,
  compareChapterStarts,
  isValidOrderKey,
  orderKeyOf,
  photoOrderBy,
} from "./photo-order";

const photo = {
  takenAt: new Date("2026-09-05T08:07:33.880Z"),
  createdAt: new Date("2026-09-20T10:00:00.000Z"),
  fileOrderKey: "svatba000000000006p000000000005d000000002738jpg",
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
});

describe("queries", () => {
  it("orders by the order's own column, id as the tiebreaker", () => {
    expect(photoOrderBy("TAKEN_AT")).toEqual([{ takenAt: "asc" }, { id: "asc" }]);
    expect(photoOrderBy("FILE_NAME")).toEqual([{ fileOrderKey: "asc" }, { id: "asc" }]);
  });

  it("pages strictly after a position, in the order's own column", () => {
    expect(afterPosition("FILE_NAME", { key: "svatba", id: "p1" })).toEqual({
      OR: [{ fileOrderKey: { gt: "svatba" } }, { fileOrderKey: "svatba", id: { gt: "p1" } }],
    });
    const at = "2026-09-05T08:07:33.880Z";
    expect(afterPosition("TAKEN_AT", { key: at, id: "p1" })).toEqual({
      OR: [{ takenAt: { gt: new Date(at) } }, { takenAt: new Date(at), id: { gt: "p1" } }],
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
    startFileOrderKey: "svatba000000000002jpg",
    startPhotoId: "b",
  };
  const pripravy = {
    startTakenAt: new Date("2026-09-05T12:00:00.000Z"),
    startFileOrderKey: "svatba000000000001jpg",
    startPhotoId: "a",
  };

  it("start on the same photo in either order, at that order's key", () => {
    expect(chapterStartOf("TAKEN_AT", obrad)).toEqual({ key: "2026-09-05T11:00:00.000Z", id: "b" });
    expect(chapterStartOf("FILE_NAME", obrad)).toEqual({ key: "svatba000000000002jpg", id: "b" });
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
    expect(isValidOrderKey("FILE_NAME", "svatba000000000001jpg")).toBe(true);
    expect(isValidOrderKey("FILE_NAME", "")).toBe(true);
    expect(isValidOrderKey("FILE_NAME", "Svatba_01")).toBe(false);
    expect(isValidOrderKey("FILE_NAME", "a".repeat(1025))).toBe(false);
  });
});
