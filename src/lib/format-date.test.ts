import { describe, expect, it } from "vitest";
import { formatDate, formatDigestDay, previousDay } from "./format-date";

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
    expect(formatDate(date, "de")).toBe("15.8.2026");
    expect(formatDate(date, "es")).toBe("15/8/2026");
    expect(formatDate(date, "sk")).toBe("15. 8. 2026");
    expect(formatDate(date, "pl")).toBe("15.08.2026");
  });

  it("falls back to the default language for a locale the app does not speak", () => {
    expect(formatDate(new Date("2026-08-14T22:00:00Z"), "ja")).toBe("8/15/2026");
  });
});

describe("formatDigestDay", () => {
  it("uses Prague calendar day for digest subject lines", () => {
    expect(formatDigestDay(new Date("2026-08-14T22:00:00Z"))).toBe("15. srpna");
  });
});

describe("previousDay", () => {
  it("is the calendar day before, even after the 23-hour spring-forward day", () => {
    // 30 March 2026, 00:30 CEST — 24 hours earlier is still 28 March.
    const now = new Date("2026-03-29T22:30:00Z");
    expect(formatDate(previousDay(now), "cs")).toBe("29. 3. 2026");
  });

  it("uses Prague's date, not UTC's, just after midnight", () => {
    // 1 October 2026, 00:10 CEST is 30 September in UTC.
    expect(formatDate(previousDay(new Date("2026-09-30T22:10:00Z")), "cs")).toBe("30. 9. 2026");
  });
});
