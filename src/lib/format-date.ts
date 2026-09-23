import { DEFAULT_LOCALE, isLocale, LOCALE_TAGS } from "@/i18n/locales";

export const TIME_ZONE = "Europe/Prague";

/**
 * `locale` is the app's bare language code ("cs" | "en" | "fr"); anything the
 * app does not speak falls back to the default rather than to the runtime's
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

/** Admin-only (the photographer's daily digest e-mail) — always Czech. */
export function formatDigestDay(date: Date): string {
  return date.toLocaleDateString("cs-CZ", {
    day: "numeric",
    month: "long",
    timeZone: TIME_ZONE,
  });
}
