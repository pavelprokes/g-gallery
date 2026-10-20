import type { Locale } from "@/i18n/locales";

/** The client guide is written in every language the app speaks (src/app/navod/guide-page.tsx). */
export type GuideLocale = Locale;

/**
 * Where each language's guide lives. Czech and English keep the addresses they
 * were published under; the rest sit under `/guide`.
 */
export const GUIDE_PATHS: Record<GuideLocale, string> = {
  cs: "/navod",
  en: "/guide",
  fr: "/guide/fr",
  de: "/guide/de",
  es: "/guide/es",
  sk: "/guide/sk",
  pl: "/guide/pl",
};

/** Each language named in itself, for the list of the guide's other languages. */
export const GUIDE_LANGUAGE_NAMES: Record<GuideLocale, string> = {
  cs: "Čeština",
  en: "English",
  fr: "Français",
  de: "Deutsch",
  es: "Español",
  sk: "Slovenčina",
  pl: "Polski",
};

/** The guide a viewer reading `locale` should be sent to. */
export function guidePath(locale: Locale): string {
  return GUIDE_PATHS[locale];
}
