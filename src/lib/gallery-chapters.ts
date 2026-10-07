import { TRANSLATED_LOCALES, type TranslatedLocale } from "@/lib/content-translations";
import { slugify } from "@/lib/gallery-slug";

/**
 * Chapters — named stretches of a gallery's timeline (docs/CHAPTERS.md).
 *
 * Client-safe: the grid places chapter headers in the browser, against the
 * photos it has loaded, so that a refetch (a guest's upload, a tab regaining
 * focus) can never leave a header sitting one photo off its boundary.
 */

/**
 * A place in the gallery's order — `(key, id)`, the same pair the photo
 * cursor pages by (src/lib/photo-cursor.ts). `key` is the capture time as an
 * ISO string or the file-name key, whichever order the gallery is shown in
 * (src/lib/photo-order.ts); both compare correctly as plain strings.
 */
export interface TimelinePosition {
  key: string;
  id: string;
}

/** What a viewer's grid gets for each chapter. */
export interface GalleryChapter {
  id: string;
  /** Already localized for the viewer. */
  title: string;
  /** The URL hash that links to it — the frozen slug, or the id for a
   * chapter from before slugs existed. Never localized: an English guest's
   * link must open the same chapter for a Czech one. */
  anchor: string;
  start: TimelinePosition;
  /** Photos in the chapter at page load — for the header's "84 fotek" only;
   * placement never depends on it. */
  count: number;
}

/**
 * The gallery's order, identical to the database's `orderBy: [key, id]`
 * (`photoOrderBy` in src/lib/photo-order.ts).
 *
 * Ids are cuids and file-name keys are [0-9a-z] — both sort the same under a
 * plain string comparison and under Postgres's collation.
 */
export function compareTimeline(a: TimelinePosition, b: TimelinePosition): number {
  if (a.key !== b.key) return a.key < b.key ? -1 : 1;
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return 0;
}

export const MAX_CHAPTER_TITLE = 60;

/**
 * The chapters most Czech weddings are shot in, in the order the day runs,
 * with their guest-facing translations ready. Picking one of these fills the
 * EN/FR fields on its own, so the common case needs no translating at all; a
 * typed title that is not a preset is translated by hand, like any other text.
 */
export const CHAPTER_PRESETS: readonly ({ cs: string } & Record<TranslatedLocale, string>)[] = [
  {
    cs: "Přípravy",
    en: "Getting ready",
    fr: "Préparatifs",
    de: "Vorbereitung",
    es: "Preparativos",
    sk: "Prípravy",
    pl: "Przygotowania",
  },
  {
    cs: "Obřad",
    en: "Ceremony",
    fr: "Cérémonie",
    de: "Trauung",
    es: "Ceremonia",
    sk: "Obrad",
    pl: "Ceremonia",
  },
  {
    cs: "Gratulace",
    en: "Congratulations",
    fr: "Félicitations",
    de: "Gratulation",
    es: "Felicitaciones",
    sk: "Gratulácie",
    pl: "Życzenia",
  },
  {
    cs: "Skupinové fotky",
    en: "Group photos",
    fr: "Photos de groupe",
    de: "Gruppenfotos",
    es: "Fotos de grupo",
    sk: "Skupinové fotky",
    pl: "Zdjęcia grupowe",
  },
  {
    cs: "Portréty",
    en: "Portraits",
    fr: "Portraits",
    de: "Porträts",
    es: "Retratos",
    sk: "Portréty",
    pl: "Portrety",
  },
  {
    cs: "Hostina",
    en: "Wedding feast",
    fr: "Le repas",
    de: "Hochzeitsfeier",
    es: "El banquete",
    sk: "Hostina",
    pl: "Wesele",
  },
  {
    cs: "Tradice",
    en: "Traditions",
    fr: "Traditions",
    de: "Bräuche",
    es: "Tradiciones",
    sk: "Tradície",
    pl: "Tradycje",
  },
  {
    cs: "Krájení dortu",
    en: "Cutting the cake",
    fr: "La pièce montée",
    de: "Tortenanschnitt",
    es: "Corte de la tarta",
    sk: "Krájanie torty",
    pl: "Krojenie tortu",
  },
  {
    cs: "První tanec",
    en: "First dance",
    fr: "Première danse",
    de: "Erster Tanz",
    es: "Primer baile",
    sk: "Prvý tanec",
    pl: "Pierwszy taniec",
  },
  {
    cs: "Večerní zábava",
    en: "Evening party",
    fr: "La soirée",
    de: "Abendfeier",
    es: "La fiesta",
    sk: "Večerná zábava",
    pl: "Zabawa wieczorna",
  },
];

/**
 * A chapter's link anchor, unique within the gallery and frozen at creation.
 *
 * One anchor for every language, so a link means the same chapter whoever
 * sends it and whoever opens it. It has to be *one* language, and it is
 * English — the app's own fallback language (docs/I18N.md) and the one a
 * guest of any nationality reads: a preset takes its English name ("Obřad" →
 * `ceremony`, "První tanec" → `first-dance`). A custom title has no English
 * yet when the chapter is created, so it is transliterated to plain ASCII
 * ("Rozbíjení talíře" → `rozbijeni-talire`). A second chapter with the same
 * name gets `-2`.
 */
export function chapterSlug(title: string, taken: readonly string[]): string {
  const base = slugify(presetTranslations(title)?.en ?? title) || "chapter";
  if (!taken.includes(base)) return base;
  let n = 2;
  while (taken.includes(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

/** A stored chapter's link anchor: its frozen slug, or its id for a row that
 * never got one. The one place this fallback lives. */
export function chapterAnchor(chapter: { id: string; slug: string | null }): string {
  return chapter.slug ?? chapter.id;
}

/** The ready-made translations for a preset title, or null for a custom one. */
export function presetTranslations(title: string): Record<TranslatedLocale, string> | null {
  const needle = title.trim().toLocaleLowerCase("cs");
  const preset = CHAPTER_PRESETS.find((p) => p.cs.toLocaleLowerCase("cs") === needle);
  if (!preset) return null;
  return Object.fromEntries(TRANSLATED_LOCALES.map((l) => [l, preset[l]])) as Record<
    TranslatedLocale,
    string
  >;
}
