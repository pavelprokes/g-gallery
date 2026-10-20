import { CZECH_READING_LOCALES, type Locale } from "@/i18n/locales";

/** The languages the client guide is written in (src/app/navod/guide-page.tsx). */
export type GuideLocale = "cs" | "en";

export const GUIDE_PATHS: Record<GuideLocale, string> = { cs: "/navod", en: "/guide" };

/** The guide a viewer reading `locale` should be sent to: Czech for Czech readers, English for everyone else. */
export function guidePath(locale: Locale): string {
  return locale === "cs" || CZECH_READING_LOCALES.includes(locale)
    ? GUIDE_PATHS.cs
    : GUIDE_PATHS.en;
}
