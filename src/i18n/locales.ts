// Split out from request.ts (which imports next/headers) so client
// components can import the locale vocabulary without pulling a
// server-only module into the browser bundle.
//
// Adding a language: append it here, add `messages/<code>.json` (the
// catalog parity test fails until every key exists), name it in every
// catalog's `localeSwitcher`, and give the printable QR sign its copy
// (src/components/printable-sign.tsx). Everything else — negotiation,
// `<html lang>`, the switcher, date formatting — reads this list.
// See docs/I18N.md.
export const LOCALES = ["cs", "en", "fr"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "cs";
export const LOCALE_COOKIE = "NEXT_LOCALE";

/**
 * Full BCP-47 tag per locale — what `Intl` formatters want, as opposed to
 * the bare language the catalogs and the cookie are keyed by. A gallery has
 * one photographer in one country, so one region per language is enough:
 * a French-speaking guest from Belgium still reads "15/08/2026" the same way.
 */
export const LOCALE_TAGS: Record<Locale, string> = {
  cs: "cs-CZ",
  en: "en-US",
  fr: "fr-FR",
};

/** The same, in the underscore form Open Graph (`og:locale`) insists on. */
export const OG_LOCALES: Record<Locale, string> = {
  cs: "cs_CZ",
  en: "en_US",
  fr: "fr_FR",
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}
