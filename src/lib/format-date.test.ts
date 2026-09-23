import { describe, expect, it } from "vitest";
import { formatDate, formatDigestDay } from "./format-date";

describe("formatDate", () => {
  it("renders a Prague-midnight date as that day, not the one before", () => {
    expect(formatDate(new Date("2026-08-14T22:00:00Z"), "cs")).toBe("15. 8. 2026");
  });

  it("renders the first of the month correctly in UTC CI", () => {
    expect(formatDate(new Date("2026-07-31T22:00:00Z"), "cs")).toBe("1. 8. 2026");
  });

  it("uses each language's own date order", () => {
    const date = new Date("2026-08-14T22:00:00Z");
    expect(formatDate(date, "en")).toBe("8/15/2026");
    expect(formatDate(date, "fr")).toBe("15/08/2026");
  });

  it("falls back to the default language for a locale the app does not speak", () => {
    expect(formatDate(new Date("2026-08-14T22:00:00Z"), "de")).toBe("8/15/2026");
  });
});

describe("formatDigestDay", () => {
  it("uses Prague calendar day for digest subject lines", () => {
    expect(formatDigestDay(new Date("2026-08-14T22:00:00Z"))).toBe("15. srpna");
  });
});
