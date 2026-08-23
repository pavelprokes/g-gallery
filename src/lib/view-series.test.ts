import { describe, expect, it } from "vitest";
import {
  buildViewSeries,
  dayKey,
  emptySeries,
  lastDays,
  seriesMax,
  windowStart,
  type ViewSessionRow,
} from "./view-series";

const NOW = new Date("2026-08-23T12:00:00Z");

function session(galleryId: string, viewerId: string, startedAt: string): ViewSessionRow {
  return { galleryId, viewerId, startedAt: new Date(startedAt) };
}

describe("dayKey", () => {
  it("buckets by the photographer's day, not UTC's", () => {
    // 23:30 UTC in August is 01:30 the next morning in Prague.
    expect(dayKey(new Date("2026-08-23T23:30:00Z"))).toBe("2026-08-24");
  });
});

describe("lastDays", () => {
  it("ends with today and runs oldest first", () => {
    const days = lastDays(NOW, 3);
    expect(days).toEqual(["2026-08-21", "2026-08-22", "2026-08-23"]);
  });

  it("crosses a month boundary", () => {
    expect(lastDays(new Date("2026-09-01T09:00:00Z"), 2)).toEqual(["2026-08-31", "2026-09-01"]);
  });

  it("keeps one column per day across the DST change", () => {
    // Prague went back to UTC+1 on 2026-10-25; naive local arithmetic repeats a day.
    const days = lastDays(new Date("2026-10-26T09:00:00Z"), 4);
    expect(days).toEqual(["2026-10-23", "2026-10-24", "2026-10-25", "2026-10-26"]);
    expect(new Set(days).size).toBe(4);
  });
});

describe("windowStart", () => {
  it("reaches back past the first day's Prague midnight", () => {
    expect(windowStart(NOW, 3).toISOString()).toBe("2026-08-20T00:00:00.000Z");
  });
});

describe("buildViewSeries", () => {
  const days = lastDays(NOW, 3);
  const groupOf = (galleryId: string) => (galleryId === "hidden" ? undefined : galleryId);

  it("splits a day into people and their extra visits", () => {
    const series = buildViewSeries(
      [
        session("g1", "v1", "2026-08-23T08:00:00Z"),
        session("g1", "v1", "2026-08-23T18:00:00Z"),
        session("g1", "v2", "2026-08-23T09:00:00Z"),
      ],
      days,
      groupOf,
    );
    expect(series.get("g1")?.points.at(-1)).toEqual({ day: "2026-08-23", unique: 2, repeat: 1 });
  });

  it("counts a viewer once in the window even when they come back on another day", () => {
    const series = buildViewSeries(
      [session("g1", "v1", "2026-08-21T08:00:00Z"), session("g1", "v1", "2026-08-23T08:00:00Z")],
      days,
      groupOf,
    );
    expect(series.get("g1")).toMatchObject({ unique: 1, repeat: 1, total: 2 });
    // Both days still show a person, because on each of them one person looked.
    expect(series.get("g1")?.points.map((p) => p.unique)).toEqual([1, 0, 1]);
  });

  it("keeps a column for every day, including the silent ones", () => {
    const series = buildViewSeries([session("g1", "v1", "2026-08-22T08:00:00Z")], days, groupOf);
    expect(series.get("g1")?.points.map((p) => p.day)).toEqual(days);
  });

  it("merges the galleries of one wedding into a single series", () => {
    const series = buildViewSeries(
      [session("g1", "v1", "2026-08-23T08:00:00Z"), session("g2", "v2", "2026-08-23T08:00:00Z")],
      days,
      () => "e1",
    );
    expect(series.get("e1")).toMatchObject({ unique: 2, total: 2, repeat: 0 });
  });

  it("drops sessions outside the window and galleries not on the page", () => {
    const series = buildViewSeries(
      [
        session("g1", "v1", "2026-07-01T08:00:00Z"),
        session("hidden", "v2", "2026-08-23T08:00:00Z"),
      ],
      days,
      groupOf,
    );
    expect(series.size).toBe(0);
  });
});

describe("emptySeries", () => {
  it("is a full-width row of zeroes", () => {
    const series = emptySeries(lastDays(NOW, 3));
    expect(series.points).toHaveLength(3);
    expect(series.total).toBe(0);
  });
});

describe("seriesMax", () => {
  it("is the tallest column anywhere, so rows share one scale", () => {
    const days = lastDays(NOW, 3);
    const series = buildViewSeries(
      [
        session("g1", "v1", "2026-08-23T08:00:00Z"),
        session("g2", "v2", "2026-08-22T08:00:00Z"),
        session("g2", "v3", "2026-08-22T09:00:00Z"),
        session("g2", "v3", "2026-08-22T11:00:00Z"),
      ],
      days,
      (id) => id,
    );
    expect(seriesMax(series.values())).toBe(3);
  });

  it("never returns zero — an empty page still needs a divisor", () => {
    expect(seriesMax([emptySeries(lastDays(NOW, 3))])).toBe(1);
  });
});
