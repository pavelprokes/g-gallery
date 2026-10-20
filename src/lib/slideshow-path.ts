import type { Locale } from "@/i18n/locales";

/**
 * Where the public slideshow maker lives in each language (docs/SLIDESHOW-MAKER.md
 * §6): one address per language, in that language's own words, so each page
 * is found by what people there search for. Frozen once published.
 */
export const SLIDESHOW_PATHS = {
  cs: "/video-z-fotek",
  en: "/video-from-photos",
  fr: "/diaporama-video",
  de: "/video-aus-fotos",
  es: "/video-con-fotos",
  sk: "/video-z-fotiek",
  pl: "/film-ze-zdjec",
} as const satisfies Record<Locale, string>;

export type SlideshowLocale = keyof typeof SLIDESHOW_PATHS;
