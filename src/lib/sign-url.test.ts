import { describe, expect, it } from "vitest";
import { absoluteSignUrl, eventSignPath, gallerySignPath, requestedSharePath } from "./sign-url";

describe("gallerySignPath", () => {
  it("builds the same shape CopyableLink already renders for a share link", () => {
    expect(gallerySignPath("-va8I3IzPVLyNLDnfcyS_Q", "test-galerie-2026-08-21")).toBe(
      "/g/-va8I3IzPVLyNLDnfcyS_Q/test-galerie-2026-08-21",
    );
  });

  it("tolerates a missing slug rather than embedding the literal string 'null'", () => {
    expect(gallerySignPath("-va8I3IzPVLyNLDnfcyS_Q", null)).toBe("/g/-va8I3IzPVLyNLDnfcyS_Q/");
  });
});

describe("eventSignPath", () => {
  it("builds the wedding page's own address, not a gallery address", () => {
    expect(eventSignPath("evToken", "pavel-a-patricie-statek-benice-2026-08-12")).toBe(
      "/s/evToken/pavel-a-patricie-statek-benice-2026-08-12",
    );
  });
});

describe("absoluteSignUrl", () => {
  it("prefixes the fixed production origin, not a request-derived host", () => {
    expect(absoluteSignUrl("/g/-va8I3IzPVLyNLDnfcyS_Q/test-galerie")).toBe(
      "https://photos.svatebni-fotograf-cechy.cz/g/-va8I3IzPVLyNLDnfcyS_Q/test-galerie",
    );
  });
});

describe("requestedSharePath", () => {
  it("re-encodes the decoded params into the path that was requested", () => {
    expect(requestedSharePath("g", "tok", ["svatba-šťastných x"])).toBe(
      "/g/tok/svatba-%C5%A1%C5%A5astn%C3%BDch%20x",
    );
  });

  it("drops nothing and adds nothing when there is no slug", () => {
    expect(requestedSharePath("s", "tok")).toBe("/s/tok");
  });
});
