import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  gallery: { findFirst: vi.fn(), findMany: vi.fn() },
  photo: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn() },
}));
const r2 = vi.hoisted(() => ({ copyObject: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: db }));
vi.mock("@/lib/r2", () => r2);
const markChanged = vi.hoisted(() => vi.fn());
vi.mock("@/lib/zip-build", () => ({ markGalleryPhotosChanged: markChanged }));

import {
  WEB_SLUG_PATTERN,
  copyPhotosToWebGalleryFor,
  refusalOf,
  webGalleryBySlug,
} from "./web-gallery";

const row = (over: object = {}) => ({
  id: "p1",
  objectKey: "galleries/web/p1.jpg",
  thumbObjectKey: "galleries/web/p1.thumb.webp",
  fileName: "svatba_0161__MG_7516.jpg",
  width: 6720,
  height: 4480,
  takenAt: new Date("2026-08-01T09:13:56.600Z"),
  thumbhash: null,
  placeholder: null,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  r2.copyObject.mockReset();
  r2.copyObject.mockResolvedValue(undefined);
});

describe("refusalOf", () => {
  it("has no API at all without a secret", () => {
    expect(refusalOf("Bearer anything", undefined)).toBe("disabled");
    expect(refusalOf(null, "")).toBe("disabled");
  });

  it("takes only the exact bearer", () => {
    expect(refusalOf("Bearer s3cret", "s3cret")).toBeNull();
    expect(refusalOf("Bearer nope", "s3cret")).toBe("unauthorized");
    expect(refusalOf("s3cret", "s3cret")).toBe("unauthorized");
    expect(refusalOf(null, "s3cret")).toBe("unauthorized");
  });
});

describe("WEB_SLUG_PATTERN", () => {
  it("takes the website's uids and nothing that could leave the path", () => {
    expect(WEB_SLUG_PATTERN.test("katerina-a-tomas-07-10-2022")).toBe(true);
    for (const bad of ["Eliska", "a/b", "../x", "-a", "a-", "a--b", ""]) {
      expect(WEB_SLUG_PATTERN.test(bad)).toBe(false);
    }
  });
});

describe("webGalleryBySlug", () => {
  const gallery = {
    id: "g1",
    title: "Eliška a Martin",
    eventDate: new Date("2026-08-01T00:00:00Z"),
    coverPhotoId: "p1",
    photoOrder: "FILE_NAME",
  };

  it("asks only for a live gallery and only for the photographer's finished photos", async () => {
    db.gallery.findFirst.mockResolvedValue(gallery);
    db.photo.findMany.mockResolvedValue([row()]);

    const result = await webGalleryBySlug("eliska-a-martin-2026");

    expect(db.gallery.findFirst.mock.calls[0]![0].where).toEqual({
      webSlug: "eliska-a-martin-2026",
      status: "PUBLISHED",
      trashedAt: null,
    });
    expect(db.photo.findMany.mock.calls[0]![0].where).toEqual({
      galleryId: "g1",
      status: "CONFIRMED",
      source: "OWNER",
      videoObjectKey: null,
    });
    expect(result).toMatchObject({
      eventDate: "2026-08-01",
      coverPhotoId: "p1",
      photos: [{ id: "p1", takenAt: "2026-08-01T09:13:56.600Z" }],
    });
  });

  it("selects nothing about people", async () => {
    db.gallery.findFirst.mockResolvedValue(gallery);
    db.photo.findMany.mockResolvedValue([]);
    await webGalleryBySlug("x");
    const selected = Object.keys(db.photo.findMany.mock.calls[0]![0].select);
    for (const field of ["faces", "uploadedByViewerId", "favorites", "reactions", "faceTags"]) {
      expect(selected).not.toContain(field);
    }
  });

  it("drops a cover that is not one of the public photos", async () => {
    db.gallery.findFirst.mockResolvedValue({ ...gallery, coverPhotoId: "guest-photo" });
    db.photo.findMany.mockResolvedValue([row()]);
    expect((await webGalleryBySlug("x"))?.coverPhotoId).toBeNull();
  });

  it("is null for anything that is not a live web gallery", async () => {
    db.gallery.findFirst.mockResolvedValue(null);
    expect(await webGalleryBySlug("x")).toBeNull();
    expect(db.photo.findMany).not.toHaveBeenCalled();
  });
});

describe("copyPhotosToWebGalleryFor", () => {
  const source = {
    objectKey: "galleries/client/a.jpg",
    thumbObjectKey: "galleries/client/a.thumb.webp",
    fileName: "a.jpg",
    mimeType: "image/jpeg",
    sizeBytes: 10,
    crc32: "c",
    etag: "e",
    width: 4,
    height: 3,
    placeholder: null,
    thumbhash: null,
    takenAt: new Date("2026-08-01T09:00:00Z"),
    xmpRating: null,
    xmpLabel: null,
    xmpHighlight: false,
  };

  beforeEach(() => {
    db.gallery.findFirst.mockResolvedValue({ id: "web", storagePrefix: "galleries/web" });
  });

  it("refuses a target that is not the owner's web gallery", async () => {
    db.gallery.findFirst.mockResolvedValue(null);
    await expect(copyPhotosToWebGalleryFor("o", "g", ["p"])).rejects.toThrow("NOT_FOUND");
    expect(db.gallery.findFirst.mock.calls[0]![0].where).toMatchObject({
      ownerId: "o",
      webSlug: { not: null },
      trashedAt: null,
    });
    expect(r2.copyObject).not.toHaveBeenCalled();
  });

  it("copies the original and the thumbnail into the target's prefix, then writes the row", async () => {
    db.photo.findMany.mockResolvedValueOnce([source]).mockResolvedValueOnce([]);

    expect(await copyPhotosToWebGalleryFor("o", "web", ["p"])).toEqual({
      copied: 1,
      skipped: 0,
      failed: 0,
    });

    const calls = r2.copyObject.mock.calls as [string, string][];
    const [fromOriginal, toOriginal] = calls[0]!;
    const [fromThumb, toThumb] = calls[1]!;
    expect(fromOriginal).toBe(source.objectKey);
    expect(toOriginal).toMatch(/^galleries\/web\/[0-9a-f-]+\.jpg$/);
    expect(fromThumb).toBe(source.thumbObjectKey);
    expect(toThumb).toBe(toOriginal.replace(".jpg", ".thumb.webp"));
    expect(db.photo.create.mock.calls[0]![0].data).toMatchObject({
      galleryId: "web",
      objectKey: toOriginal,
      thumbObjectKey: toThumb,
      status: "CONFIRMED",
      source: "OWNER",
      wovenAt: source.takenAt,
    });
  });

  it("only reads the owner's finished photos, and never from the target itself", async () => {
    db.photo.findMany.mockResolvedValue([]);
    await copyPhotosToWebGalleryFor("o", "web", ["p"]);
    expect(db.photo.findMany.mock.calls[0]![0].where).toMatchObject({
      id: { in: ["p"] },
      galleryId: { not: "web" },
      gallery: { ownerId: "o" },
      status: "CONFIRMED",
      source: "OWNER",
      videoObjectKey: null,
    });
  });

  it("skips a file already there, so a second run finishes the job", async () => {
    db.photo.findMany
      .mockResolvedValueOnce([source, { ...source, objectKey: "x.jpg", fileName: "b.jpg" }])
      .mockResolvedValueOnce([{ fileName: "a.jpg", crc32: "c", etag: "e" }]);

    expect(await copyPhotosToWebGalleryFor("o", "web", ["p", "q"])).toEqual({
      copied: 1,
      skipped: 1,
      failed: 0,
    });
    expect(db.photo.create).toHaveBeenCalledTimes(1);
  });

  it("copies another photo with the same name: two cameras can share one", async () => {
    db.photo.findMany
      .mockResolvedValueOnce([source, { ...source, objectKey: "x.jpg", crc32: "other" }])
      .mockResolvedValueOnce([]);
    expect(await copyPhotosToWebGalleryFor("o", "web", ["p", "q"])).toMatchObject({ copied: 2 });
  });

  it("counts what it never read, a guest photo in the selection, as skipped", async () => {
    db.photo.findMany.mockResolvedValueOnce([source]).mockResolvedValueOnce([]);
    expect(await copyPhotosToWebGalleryFor("o", "web", ["p", "guest"])).toEqual({
      copied: 1,
      skipped: 1,
      failed: 0,
    });
  });

  it("does not lose the photo to a thumbnail that never landed", async () => {
    db.photo.findMany.mockResolvedValueOnce([source]).mockResolvedValueOnce([]);
    r2.copyObject.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("404"));
    expect(await copyPhotosToWebGalleryFor("o", "web", ["p"])).toMatchObject({ copied: 1 });
    expect(db.photo.create.mock.calls[0]![0].data.thumbObjectKey).toBeNull();
  });

  it("writes no row for a photo whose original failed, and goes on with the rest", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    db.photo.findMany
      .mockResolvedValueOnce([source, { ...source, objectKey: "x.jpg", fileName: "b.jpg" }])
      .mockResolvedValueOnce([]);
    r2.copyObject.mockImplementation(async (from: string) => {
      if (from === source.objectKey) throw new Error("R2 copy failed");
    });
    expect(await copyPhotosToWebGalleryFor("o", "web", ["p", "q"])).toEqual({
      copied: 1,
      skipped: 0,
      failed: 1,
    });
    expect(db.photo.create).toHaveBeenCalledTimes(1);
    expect(markChanged).toHaveBeenCalledWith("web");
  });
});
