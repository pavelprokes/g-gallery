import { describe, expect, it } from "vitest";
import { digestWindow } from "./digest";

const DAY = 24 * 60 * 60 * 1000;

describe("digestWindow", () => {
  it("is identical for every instant within the same Prague day", () => {
    // This is the property that matters: the window doubles as the idempotency
    // key for "already emailed", so drift lets a duplicate cron delivery send
    // the digest a second time. It did, until the millisecond leak was fixed.
    const morning = digestWindow(new Date("2026-08-21T05:00:00.123Z"));
    const noon = digestWindow(new Date("2026-08-21T10:17:42.987Z"));
    const evening = digestWindow(new Date("2026-08-21T21:59:59.001Z"));

    expect(noon.since.getTime()).toBe(morning.since.getTime());
    expect(evening.since.getTime()).toBe(morning.since.getTime());
    expect(noon.until.getTime()).toBe(morning.until.getTime());
  });

  it("does not depend on the sub-second part of the clock", () => {
    const a = digestWindow(new Date("2026-08-21T05:00:00.000Z"));
    const b = digestWindow(new Date("2026-08-21T05:00:00.999Z"));
    expect(a.since.getTime()).toBe(b.since.getTime());
  });

  it("covers exactly 24 hours", () => {
    const { since, until } = digestWindow(new Date("2026-08-21T05:00:00Z"));
    expect(until.getTime() - since.getTime()).toBe(DAY);
  });

  it("ends at Prague midnight — 22:00 UTC the previous day in summer", () => {
    // CEST is UTC+2, so "today at 00:00 Prague" is 22:00 UTC yesterday.
    const { until } = digestWindow(new Date("2026-08-21T05:00:00Z"));
    expect(until.toISOString()).toBe("2026-08-20T22:00:00.000Z");
  });

  it("ends at Prague midnight — 23:00 UTC the previous day in winter", () => {
    // CET is UTC+1. Getting this wrong would shift the whole window by an hour
    // twice a year and silently drop or double-count an hour of activity.
    const { until } = digestWindow(new Date("2026-01-15T05:00:00Z"));
    expect(until.toISOString()).toBe("2026-01-14T23:00:00.000Z");
  });

  it("moves on to the next window the following day", () => {
    const today = digestWindow(new Date("2026-08-21T05:00:00Z"));
    const tomorrow = digestWindow(new Date("2026-08-22T05:00:00Z"));
    expect(tomorrow.since.getTime()).toBe(today.since.getTime() + DAY);
  });

  it("keeps the same window just after Prague midnight", () => {
    // 22:30 UTC is already the next Prague day in summer.
    const before = digestWindow(new Date("2026-08-21T21:30:00Z"));
    const after = digestWindow(new Date("2026-08-21T22:30:00Z"));
    expect(after.since.getTime()).toBe(before.since.getTime() + DAY);
  });
});
