import type { Locale } from "@/i18n/locales";

/**
 * Where the public slideshow maker lives in each language it is written in
 * (docs/SLIDESHOW-MAKER.md §6). Czech first; the other languages join this map
 * once their copy is done, and the sitemap and hreflang follow it.
 */
export const SLIDESHOW_PATHS = {
  cs: "/video-z-fotek",
} as const satisfies Partial<Record<Locale, string>>;

export type SlideshowLocale = keyof typeof SLIDESHOW_PATHS;
