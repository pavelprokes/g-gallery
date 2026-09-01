/**
 * The little two-series chart on every row of /admin.
 *
 * It answers one question the raw totals cannot: *is anyone still looking?* A
 * gallery with 400 views is a different thing depending on whether they landed
 * the day the link went out or are still trickling in a week later — and the
 * split between people and visits is what tells "one couple refreshing" apart
 * from "the family found it".
 *
 * Bucketing is pure and tested rather than done in SQL: Postgres would have to
 * be told the timezone anyway (the column is UTC, the photographer reads Prague
 * days), and a `groupBy` cannot express "distinct viewers per day" and "visits
 * per day" in one pass.
 */

import { TIME_ZONE } from "@/lib/format-date";

/** Two weeks: long enough to show the tail after a link goes out, short enough
 *  that a 6px column per day still fits beside a list row. */
export const SERIES_DAYS = 14;

/** Every day boundary in this app is the photographer's day, not UTC's. */

const DAY_MS = 24 * 60 * 60 * 1000;

/** "YYYY-MM-DD" — en-CA is ISO-ordered, which makes the keys sortable. */
const dayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export interface ViewSessionRow {
  galleryId: string;
  viewerId: string;
  startedAt: Date;
}

export interface DayPoint {
  /** Prague calendar day, "YYYY-MM-DD". */
  day: string;
  /** People who opened it that day. */
  unique: number;
  /** Visits beyond each of those people's first one that day. */
  repeat: number;
}

export interface ViewSeries {
  points: DayPoint[];
  /** Distinct viewers across the whole window — deliberately NOT the sum of the
   *  daily uniques, which would count someone who came back on Tuesday twice. */
  unique: number;
  /** Visits in the window beyond each viewer's first. */
  repeat: number;
  /** Every visit in the window: `unique + repeat`. */
  total: number;
}

export function dayKey(at: Date): string {
  return dayFormatter.format(at);
}

/** The window's day keys, oldest first, ending with today. */
export function lastDays(now: Date, count: number = SERIES_DAYS): string[] {
  const [year, month, day] = dayKey(now).split("-").map(Number) as [number, number, number];
  // Calendar arithmetic on a UTC midnight anchor: adding 86 400 000 ms to a
  // *local* timestamp skips or repeats a day twice a year, which would drop a
  // column out of the chart on the DST weekends.
  const anchor = Date.UTC(year, month - 1, day);
  const days: string[] = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    days.push(new Date(anchor - i * DAY_MS).toISOString().slice(0, 10));
  }
  return days;
}

/**
 * Lower bound for the `startedAt` query — a day earlier than the window on
 * purpose. The keys are Prague dates and the column is UTC, so the first day
 * begins at 22:00 or 23:00 UTC of the day before; over-fetching is free because
 * anything outside `days` is dropped while bucketing.
 */
export function windowStart(now: Date, count: number = SERIES_DAYS): Date {
  const first = lastDays(now, count)[0]!;
  return new Date(Date.parse(`${first}T00:00:00Z`) - DAY_MS);
}

export function emptySeries(days: string[]): ViewSeries {
  return {
    points: days.map((day) => ({ day, unique: 0, repeat: 0 })),
    unique: 0,
    repeat: 0,
    total: 0,
  };
}

/**
 * One series per group. `groupOf` maps a gallery to whatever the row is about —
 * itself on the gallery list, its wedding on the wedding list — and returning
 * undefined drops the session (a gallery that is not on the page).
 */
export function buildViewSeries(
  rows: ViewSessionRow[],
  days: string[],
  groupOf: (galleryId: string) => string | undefined,
): Map<string, ViewSeries> {
  const inWindow = new Set(days);
  /** group → day → viewer → visits that day */
  const perDay = new Map<string, Map<string, Map<string, number>>>();
  /** group → every viewer seen in the window */
  const perWindow = new Map<string, Set<string>>();
  const totals = new Map<string, number>();

  for (const row of rows) {
    const group = groupOf(row.galleryId);
    if (group === undefined) continue;
    const day = dayKey(row.startedAt);
    if (!inWindow.has(day)) continue;

    let byDay = perDay.get(group);
    if (!byDay) perDay.set(group, (byDay = new Map()));
    let viewers = byDay.get(day);
    if (!viewers) byDay.set(day, (viewers = new Map()));
    viewers.set(row.viewerId, (viewers.get(row.viewerId) ?? 0) + 1);

    let seen = perWindow.get(group);
    if (!seen) perWindow.set(group, (seen = new Set()));
    seen.add(row.viewerId);

    totals.set(group, (totals.get(group) ?? 0) + 1);
  }

  const series = new Map<string, ViewSeries>();
  for (const [group, byDay] of perDay) {
    const points = days.map((day) => {
      const viewers = byDay.get(day);
      if (!viewers) return { day, unique: 0, repeat: 0 };
      let visits = 0;
      for (const count of viewers.values()) visits += count;
      return { day, unique: viewers.size, repeat: visits - viewers.size };
    });
    const total = totals.get(group) ?? 0;
    const unique = perWindow.get(group)?.size ?? 0;
    series.set(group, { points, unique, repeat: total - unique, total });
  }
  return series;
}

/**
 * The tallest column on the page, so every row is drawn to the same scale —
 * two sparklines side by side that each normalise to their own maximum say
 * "these two galleries did about the same", which is exactly what they didn't.
 */
export function seriesMax(all: Iterable<ViewSeries>): number {
  let max = 0;
  for (const series of all) {
    for (const point of series.points) max = Math.max(max, point.unique + point.repeat);
  }
  return Math.max(1, max);
}
