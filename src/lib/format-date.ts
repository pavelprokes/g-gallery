import { DEFAULT_LOCALE, isLocale, LOCALE_TAGS } from "@/i18n/locales";

export const TIME_ZONE = "Europe/Prague";

/**
 * `locale` is the app's bare language code (one of `LOCALES`); anything the
 * app does not speak falls back to the default language rather than to the runtime's
 * own locale, so a stray value can never make one guest's dates render
 * differently from the rest of the page.
 */
function intlTag(locale: string): string {
  return LOCALE_TAGS[isLocale(locale) ? locale : DEFAULT_LOCALE];
}

export function formatDate(date: Date, locale: string): string {
  return date.toLocaleDateString(intlTag(locale), {
    timeZone: TIME_ZONE,
  });
}

export function formatDateTime(date: Date, locale: string): string {
  return date.toLocaleString(intlTag(locale), {
    timeZone: TIME_ZONE,
    day: "numeric",
    month: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** "9:08" — the clock time alone, in Prague time. */
export function formatTime(date: Date, locale: string): string {
  return date.toLocaleTimeString(intlTag(locale), {
    timeZone: TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
  });
}

/** The calendar day before `date`'s, in Prague time — "yesterday" without
 *  assuming a day is 24 hours (it is 23 or 25 around a DST change). */
export function previousDay(date: Date): Date {
  const [y, m, d] = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE })
    .format(date)
    .split("-")
    .map(Number);
  // Noon UTC is the same calendar day in Prague, summer or winter.
  return new Date(Date.UTC(y!, m! - 1, d! - 1, 12));
}

/** Admin-only (the photographer's daily digest e-mail) — always Czech. */
export function formatDigestDay(date: Date): string {
  return date.toLocaleDateString("cs-CZ", {
    day: "numeric",
    month: "long",
    timeZone: TIME_ZONE,
  });
}
