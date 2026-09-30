import { describe, expect, it } from "vitest";
import { formatEta, isCandidatePhoto, selectPhotos, smoothSpeed } from "./upload-drop";

const file = (name: string, type = "image/jpeg", size = 10, lastModified = 1) =>
  new File([new Uint8Array(size)], name, { type, lastModified });

describe("selectPhotos", () => {
  it("drops Finder and Lightroom noise but keeps photos", () => {
    expect(isCandidatePhoto(file(".DS_Store", ""))).toBe(false);
    expect(isCandidatePhoto(file("._IMG_1.jpg"))).toBe(false);
    expect(isCandidatePhoto(file("IMG_1.xmp", "application/rdf+xml"))).toBe(false);
    expect(isCandidatePhoto(file("IMG_1.CR3", ""))).toBe(false);
    // No MIME type from a folder walk: the extension decides.
    expect(isCandidatePhoto(file("IMG_1.JPG", ""))).toBe(true);
    // HEIC stays in so the run can say why it is refused.
    expect(isCandidatePhoto(file("IMG_2.heic", "image/heic"))).toBe(true);
  });

  it("never lets an untyped HEIC through as a JPEG", () => {
    const { photos } = selectPhotos([file("IMG_3.HEIC", ""), file("IMG_4.jpg", "")]);
    expect(photos.map((p) => p.type)).toEqual(["image/heic", "image/jpeg"]);
  });

  it("skips RAW and TIFF even when the browser types them as images", () => {
    expect(isCandidatePhoto(file("IMG_1.CR2", "image/x-canon-cr2"))).toBe(false);
    expect(isCandidatePhoto(file("IMG_1.dng", "image/x-adobe-dng"))).toBe(false);
    expect(isCandidatePhoto(file("scan.tif", "image/tiff"))).toBe(false);
  });

  it("dedupes and sorts numerically", () => {
    const { photos, ignored } = selectPhotos([
      file("IMG_10.jpg"),
      file("IMG_2.jpg"),
      file("IMG_2.jpg"),
      file("notes.txt", "text/plain"),
    ]);
    expect(photos.map((p) => p.name)).toEqual(["IMG_2.jpg", "IMG_10.jpg"]);
    expect(ignored).toBe(1);
  });

  it("keeps two different files that share a name", () => {
    const { photos } = selectPhotos([
      file("IMG_1.jpg", "image/jpeg", 10),
      file("IMG_1.jpg", "image/jpeg", 20),
    ]);
    expect(photos).toHaveLength(2);
  });
});

describe("progress formatting", () => {
  it("smooths speed instead of jumping to each sample", () => {
    expect(smoothSpeed(null, 100)).toBe(100);
    expect(smoothSpeed(100, 200)).toBe(120);
  });

  it("formats the ETA in words a photographer reads at a glance", () => {
    expect(formatEta(null)).toBeNull();
    expect(formatEta(Infinity)).toBeNull();
    expect(formatEta(30)).toBe("méně než minuta");
    expect(formatEta(20 * 60)).toBe("~20 min");
    expect(formatEta(80 * 60)).toBe("~1 h 20 min");
    expect(formatEta(120 * 60)).toBe("~2 h");
  });
});
