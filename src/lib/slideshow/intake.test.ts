import { describe, expect, it } from "vitest";
import { byName, byTakenAt, type PreparedPhoto } from "./intake";

const photo = (name: string, takenAt: number | null) => ({ name, takenAt }) as PreparedPhoto;

describe("byTakenAt", () => {
  it("orders by capture time, then puts photos without one after, by name", () => {
    const photos = [
      photo("IMG_10.jpg", null),
      photo("b.jpg", 2000),
      photo("IMG_9.jpg", null),
      photo("a.jpg", 1000),
    ];
    expect(photos.sort(byTakenAt).map((p) => p.name)).toEqual([
      "a.jpg",
      "b.jpg",
      "IMG_9.jpg",
      "IMG_10.jpg",
    ]);
  });

  it("keeps a burst shot in the same second in file order", () => {
    const photos = [photo("DSC_0102.jpg", 5000), photo("DSC_0101.jpg", 5000)];
    expect(photos.sort(byTakenAt).map((p) => p.name)).toEqual(["DSC_0101.jpg", "DSC_0102.jpg"]);
  });
});

describe("byName", () => {
  it("reads numbers as numbers", () => {
    expect(
      ["2.jpg", "10.jpg", "1.jpg"]
        .map((name) => ({ name }))
        .sort(byName)
        .map((p) => p.name),
    ).toEqual(["1.jpg", "2.jpg", "10.jpg"]);
  });
});
