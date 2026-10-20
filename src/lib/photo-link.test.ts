import { describe, expect, it } from "vitest";
import { isPhotoId, photoParam, withPhotoParam } from "./photo-link";

describe("photoParam", () => {
  it("reads the photo id", () => {
    expect(photoParam("?foto=cmg1abc_2-x")).toBe("cmg1abc_2-x");
  });

  it("is null without one", () => {
    expect(photoParam("")).toBeNull();
    expect(photoParam("?foto=")).toBeNull();
    expect(photoParam("?other=1")).toBeNull();
  });

  it("ignores anything that cannot be a photo id", () => {
    expect(photoParam("?foto=../admin")).toBeNull();
    expect(photoParam(`?foto=${"a".repeat(65)}`)).toBeNull();
  });
});

describe("withPhotoParam", () => {
  const base = "https://g.example/g/tok/svatba";

  it("adds the photo and keeps the hash", () => {
    expect(withPhotoParam(`${base}#obrad`, "p1")).toBe("/g/tok/svatba?foto=p1#obrad");
  });

  it("replaces the photo already there", () => {
    expect(withPhotoParam(`${base}?foto=p1`, "p2")).toBe("/g/tok/svatba?foto=p2");
  });

  it("removes it and keeps other parameters", () => {
    expect(withPhotoParam(`${base}?a=1&foto=p1`, null)).toBe("/g/tok/svatba?a=1");
    expect(withPhotoParam(`${base}?foto=p1`, null)).toBe("/g/tok/svatba");
  });
});

describe("isPhotoId", () => {
  it("takes a single id, never a repeated parameter", () => {
    expect(isPhotoId("p1")).toBe(true);
    expect(isPhotoId(["p1", "p2"])).toBe(false);
    expect(isPhotoId(undefined)).toBe(false);
  });
});
