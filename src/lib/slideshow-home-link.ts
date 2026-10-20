import slideshowCs from "@/app/video-z-fotek/slideshow.cs.json";
import slideshowDe from "@/app/video-z-fotek/slideshow.de.json";
import slideshowEn from "@/app/video-z-fotek/slideshow.en.json";
import slideshowEs from "@/app/video-z-fotek/slideshow.es.json";
import slideshowFr from "@/app/video-z-fotek/slideshow.fr.json";
import slideshowPl from "@/app/video-z-fotek/slideshow.pl.json";
import slideshowSk from "@/app/video-z-fotek/slideshow.sk.json";
import { SLIDESHOW_PATHS, type SlideshowLocale } from "@/lib/slideshow-path";

const LABELS: Record<SlideshowLocale, string> = {
  cs: slideshowCs.page.homeLink,
  en: slideshowEn.page.homeLink,
  fr: slideshowFr.page.homeLink,
  de: slideshowDe.page.homeLink,
  es: slideshowEs.page.homeLink,
  sk: slideshowSk.page.homeLink,
  pl: slideshowPl.page.homeLink,
};

/** The home page's link to the slideshow maker, in the viewer's language — just the
 * label, without loading the maker page's catalogs (src/app/video-z-fotek/slideshow-page.tsx). */
export function slideshowHomeLink(locale: SlideshowLocale): { href: string; label: string } {
  return { href: SLIDESHOW_PATHS[locale], label: LABELS[locale] };
}
