import { describe, expect, it } from "vitest";
import { absoluteSignUrl, eventSignPath, gallerySignPath } from "./sign-url";

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
