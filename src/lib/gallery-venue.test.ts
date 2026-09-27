import { describe, expect, it } from "vitest";
import { inheritsEventVenue } from "./gallery-venue";

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe("inheritsEventVenue", () => {
  it("borrows the wedding's venue for an undated gallery or one from the same day", () => {
    const event = { eventDate: day("2026-08-15"), trashedAt: null };
    expect(inheritsEventVenue(null, event)).toBe(true);
    expect(inheritsEventVenue(day("2026-08-15"), event)).toBe(true);
    expect(inheritsEventVenue(day("2026-08-15"), { eventDate: null, trashedAt: null })).toBe(true);
  });

  it("does not for a gallery from another day, a trashed wedding, or no wedding", () => {
    const event = { eventDate: day("2026-08-15"), trashedAt: null };
    expect(inheritsEventVenue(day("2026-03-12"), event)).toBe(false);
    expect(inheritsEventVenue(null, { ...event, trashedAt: day("2026-09-01") })).toBe(false);
    expect(inheritsEventVenue(null, null)).toBe(false);
  });
});
