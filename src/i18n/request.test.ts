import { describe, expect, it } from "vitest";
import { negotiateLocale } from "./request";
import { DEFAULT_LOCALE, LOCALES } from "./locales";

describe("negotiateLocale", () => {
  it("falls back to cs when there is no Accept-Language header", () => {
    expect(negotiateLocale(null)).toBe("cs");
  });

  it("picks en when the browser prefers English", () => {
    expect(negotiateLocale("en-US,en;q=0.9")).toBe("en");
  });

  it("picks cs when the browser prefers Czech", () => {
    expect(negotiateLocale("cs-CZ,cs;q=0.9,en;q=0.8")).toBe("cs");
  });

  it("falls back to cs for an unsupported language", () => {
    expect(negotiateLocale("de-DE,de;q=0.9")).toBe("cs");
  });
});

describe("headers that must not take the site down", () => {
  // `Accept-Language: *` is legal (RFC 9110) and is what Node's own `fetch`
  // sends by default. It used to reach @formatjs/intl-localematcher, which
  // threw RangeError during render — so **every page** returned 500 to any
  // client sending it, including the home page and the not-found page.
  it("falls back to the default on the wildcard", () => {
    expect(negotiateLocale("*")).toBe(DEFAULT_LOCALE);
    expect(negotiateLocale("*;q=0.5")).toBe(DEFAULT_LOCALE);
  });

  it("still honours a real preference that arrives alongside the wildcard", () => {
    expect(negotiateLocale("en;q=0.9,*;q=0.1")).toBe("en");
  });

  it("never throws, whatever the header says", () => {
    for (const header of [
      "",
      "   ",
      "*",
      "-",
      "en_US",
      "zz",
      "1",
      "a".repeat(300),
      "cs;q=abc",
      "();",
    ]) {
      expect(() => negotiateLocale(header)).not.toThrow();
      expect(LOCALES).toContain(negotiateLocale(header));
    }
  });
});
