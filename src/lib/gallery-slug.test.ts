import { describe, expect, it } from "vitest";
import { gallerySlug } from "./gallery-slug";

describe("gallerySlug", () => {
  it("combines title and date", () => {
    expect(gallerySlug("Svatba Petra a Jana", new Date("2026-08-12T00:00:00Z"))).toBe(
      "svatba-petra-a-jana-2026-08-12",
    );
  });

  it("strips Czech diacritics", () => {
    expect(gallerySlug("Křtiny Vojtíška", new Date("2026-05-01T00:00:00Z"))).toBe(
      "krtiny-vojtiska-2026-05-01",
    );
  });

  it("falls back to the title alone when there is no event date", () => {
    expect(gallerySlug("Rodinné focení", null)).toBe("rodinne-foceni");
  });

  it("collapses punctuation and whitespace into single hyphens", () => {
    expect(gallerySlug("  Svatba -- Petra & Jana!!  ", null)).toBe("svatba-petra-jana");
  });

  it("never leaves a leading or trailing hyphen", () => {
    expect(gallerySlug("---", null)).toBe("galerie");
  });

  it("falls back to a generic slug for an empty title and no date", () => {
    expect(gallerySlug("", null)).toBe("galerie");
  });

  it("caps an absurdly long title without a trailing hyphen", () => {
    const slug = gallerySlug("a".repeat(200), null);
    expect(slug.length).toBeLessThanOrEqual(80);
    expect(slug.endsWith("-")).toBe(false);
  });
});
