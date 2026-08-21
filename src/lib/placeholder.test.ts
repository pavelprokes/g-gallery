import { describe, expect, it } from "vitest";
import { DEFAULT_PLACEHOLDER, isPlaceholder, placeholderStyle } from "./placeholder";

describe("isPlaceholder", () => {
  it("accepts a 7-character lowercase hex colour", () => {
    expect(isPlaceholder("#a1b2c3")).toBe(true);
    expect(isPlaceholder("#000000")).toBe(true);
  });

  it("rejects anything else", () => {
    for (const bad of ["a1b2c3", "#abc", "#A1B2C3", "#a1b2c3ff", "red", "", "#a1b2c"]) {
      expect(isPlaceholder(bad)).toBe(false);
    }
  });

  it("rejects a value trying to break out of the style attribute", () => {
    // The value is interpolated into a style attribute, so anything that is not
    // exactly a hex colour must never reach it.
    expect(isPlaceholder("red;background-image:url(//evil)")).toBe(false);
    expect(isPlaceholder("#a1b2c3;x:y")).toBe(false);
  });
});

describe("placeholderStyle", () => {
  it("passes a valid colour through", () => {
    expect(placeholderStyle("#123456")).toBe("#123456");
  });

  it("falls back to neutral grey for a missing colour", () => {
    // Photos uploaded before the column existed have null, and canvas can fail.
    expect(placeholderStyle(null)).toBe(DEFAULT_PLACEHOLDER);
    expect(placeholderStyle(undefined)).toBe(DEFAULT_PLACEHOLDER);
  });

  it("falls back rather than emitting an untrusted value", () => {
    expect(placeholderStyle("red;background:url(//evil)")).toBe(DEFAULT_PLACEHOLDER);
  });
});
