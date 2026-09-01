import { describe, expect, it } from "vitest";
import {
  MAX_PROMO_SLOT,
  MIN_PROMO_SLOT,
  PROMO_ASPECT,
  isPromoTheme,
  isSafePromoUrl,
  promoCtaFallback,
  promoInsertIndex,
} from "@/lib/promo-card";

describe("promoInsertIndex", () => {
  it("turns a 1-based slot into a 0-based insert index", () => {
    // The stated requirement: "the 5th tile in the grid".
    expect(promoInsertIndex(5, 100)).toBe(4);
    expect(promoInsertIndex(1, 100)).toBe(0);
  });

  it("clamps to the end when the gallery holds fewer photos than the slot", () => {
    // A card placed while the gallery is still uploading must not vanish.
    expect(promoInsertIndex(5, 2)).toBe(2);
    expect(promoInsertIndex(5, 0)).toBe(0);
  });

  it("never returns a negative index for a nonsense slot", () => {
    expect(promoInsertIndex(0, 10)).toBe(0);
    expect(promoInsertIndex(-7, 10)).toBe(0);
  });

  it("truncates a fractional slot rather than producing a fractional index", () => {
    expect(promoInsertIndex(5.9, 100)).toBe(4);
  });

  it("keeps the documented slot bounds sane", () => {
    expect(MIN_PROMO_SLOT).toBe(1);
    expect(MAX_PROMO_SLOT).toBeGreaterThan(MIN_PROMO_SLOT);
  });
});

describe("PROMO_ASPECT", () => {
  it("matches a landscape frame, so a row packs as if a photo sat there", () => {
    expect(PROMO_ASPECT).toBeCloseTo(3 / 2);
  });
});

describe("isSafePromoUrl", () => {
  it("accepts absolute http(s) URLs", () => {
    expect(isSafePromoUrl("https://svatebni-fotograf-cechy.cz")).toBe(true);
    expect(isSafePromoUrl("http://example.com/portfolio?ref=galerie")).toBe(true);
  });

  it("rejects script and data URLs", () => {
    // The stored value is rendered as an href into someone else's page.
    expect(isSafePromoUrl("javascript:alert(1)")).toBe(false);
    expect(isSafePromoUrl("data:text/html,<script>alert(1)</script>")).toBe(false);
    expect(isSafePromoUrl("JavaScript:alert(1)")).toBe(false);
  });

  it("rejects relative and malformed values", () => {
    expect(isSafePromoUrl("/portfolio")).toBe(false);
    expect(isSafePromoUrl("svatebni-fotograf-cechy.cz")).toBe(false);
    expect(isSafePromoUrl("")).toBe(false);
  });

  it("rejects other absolute schemes", () => {
    expect(isSafePromoUrl("mailto:foto@example.com")).toBe(false);
    expect(isSafePromoUrl("ftp://example.com")).toBe(false);
  });
});

describe("promoCtaFallback", () => {
  it("falls back to the bare host without www", () => {
    expect(promoCtaFallback("https://www.svatebni-fotograf-cechy.cz/portfolio")).toBe(
      "svatebni-fotograf-cechy.cz",
    );
    expect(promoCtaFallback("https://instagram.com/pavel")).toBe("instagram.com");
  });

  it("returns the input unchanged when it cannot be parsed", () => {
    expect(promoCtaFallback("not a url")).toBe("not a url");
  });
});

describe("isPromoTheme", () => {
  it("accepts the three known themes and nothing else", () => {
    expect(isPromoTheme("LIGHT")).toBe(true);
    expect(isPromoTheme("DARK")).toBe(true);
    expect(isPromoTheme("BRAND")).toBe(true);
    expect(isPromoTheme("light")).toBe(false);
    expect(isPromoTheme(undefined)).toBe(false);
  });
});
