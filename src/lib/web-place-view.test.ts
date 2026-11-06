import { describe, expect, it } from "vitest";
import { describePlace, type PlaceGallery, type PlacePhoto, type WebPlace } from "./web-place-view";

const place: WebPlace = {
  key: "misto-homepage",
  label: "Homepage",
  where: "/",
  positions: ["Hero", "Pruh 1", "Pruh 2"],
  landscape: true,
  coverFirst: true,
};

const photo = (id: string, over: Partial<PlacePhoto> = {}): PlacePhoto => ({
  id,
  objectKey: `k/${id}.jpg`,
  thumbObjectKey: null,
  placeholder: null,
  fileName: `${id}.jpg`,
  width: 6000,
  height: 4000,
  ...over,
});

const gallery = (photos: PlacePhoto[], over: Partial<PlaceGallery> = {}): PlaceGallery => ({
  id: "g",
  title: "Web: Homepage",
  status: "PUBLISHED",
  coverPhotoId: null,
  photoCount: photos.length,
  photos,
  ...over,
});

const ids = (place_: WebPlace, g: PlaceGallery) =>
  describePlace(place_, g).tiles.map((tile) => tile.photo?.id ?? null);

describe("describePlace", () => {
  it("says the place is empty and every position keeps the old photo", () => {
    expect(describePlace(place, null)).toMatchObject({ state: "empty", missing: 3, unused: 0 });
  });

  it("tells a draft and a gallery without photos from one that is live", () => {
    expect(describePlace(place, gallery([photo("a")], { status: "DRAFT" })).state).toBe("draft");
    expect(describePlace(place, gallery([])).state).toBe("no_photos");
    expect(describePlace(place, gallery([photo("a")])).state).toBe("live");
  });

  it("makes the cover the hero and keeps the rest in order", () => {
    const g = gallery([photo("a"), photo("b"), photo("c")], { coverPhotoId: "c" });
    expect(ids(place, g)).toEqual(["c", "a", "b"]);
  });

  it("falls back to a hero in the file name, then to the first photo, like the website", () => {
    expect(ids(place, gallery([photo("a"), photo("b_hero")]))).toEqual(["b_hero", "a", null]);
    expect(ids(place, gallery([photo("a"), photo("b")]))).toEqual(["a", "b", null]);
  });

  it("uses the gallery's order where the cover means nothing", () => {
    const plain = { ...place, coverFirst: false };
    expect(ids(plain, gallery([photo("a"), photo("b")], { coverPhotoId: "b" }))).toEqual([
      "a",
      "b",
      null,
    ]);
  });

  it("flags a portrait only where landscape is required, and counts it as missing", () => {
    const g = gallery([photo("a"), photo("tall", { width: 4000, height: 6000 }), photo("c")]);
    const view = describePlace(place, g);
    expect(view.tiles.map((tile) => tile.rejected)).toEqual([false, true, false]);
    expect(view.missing).toBe(1);
    expect(describePlace({ ...place, landscape: false }, g).missing).toBe(0);
  });

  it("counts the photos no position uses, from the gallery's real total", () => {
    const g = gallery([photo("a"), photo("b"), photo("c"), photo("d")], { photoCount: 500 });
    expect(describePlace(place, g).unused).toBe(497);
  });
});
