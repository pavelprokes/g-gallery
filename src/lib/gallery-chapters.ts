import { slugify } from "@/lib/gallery-slug";

/**
 * Chapters — named stretches of a gallery's timeline (docs/CHAPTERS.md).
 *
 * Client-safe: the grid places chapter headers in the browser, against the
 * photos it has loaded, so that a refetch (a guest's upload, a tab regaining
 * focus) can never leave a header sitting one photo off its boundary.
 */

/**
 * A place on the gallery's timeline — the same `(takenAt, id)` pair the photo
 * cursor pages by (src/lib/photo-cursor.ts). `takenAt` travels as an ISO
 * string: `toISOString()` always has the same fixed-width shape, so two of
 * them compare correctly as plain strings.
 */
export interface TimelinePosition {
  takenAt: string;
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
 * Timeline order, identical to the database's `orderBy: [takenAt, id]`.
 *
 * Ids are cuids — lowercase ASCII letters and digits — which sort the same
 * under a plain string comparison and under Postgres's collation.
 */
export function compareTimeline(a: TimelinePosition, b: TimelinePosition): number {
  if (a.takenAt !== b.takenAt) return a.takenAt < b.takenAt ? -1 : 1;
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
export const CHAPTER_PRESETS: readonly { cs: string; en: string; fr: string }[] = [
  { cs: "Přípravy", en: "Getting ready", fr: "Préparatifs" },
  { cs: "Obřad", en: "Ceremony", fr: "Cérémonie" },
  { cs: "Gratulace", en: "Congratulations", fr: "Félicitations" },
  { cs: "Skupinové fotky", en: "Group photos", fr: "Photos de groupe" },
  { cs: "Portréty", en: "Portraits", fr: "Portraits" },
  { cs: "Hostina", en: "Wedding feast", fr: "Le repas" },
  { cs: "Tradice", en: "Traditions", fr: "Traditions" },
  { cs: "Krájení dortu", en: "Cutting the cake", fr: "La pièce montée" },
  { cs: "První tanec", en: "First dance", fr: "Première danse" },
  { cs: "Večerní zábava", en: "Evening party", fr: "La soirée" },
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

/** The ready-made translations for a preset title, or null for a custom one. */
export function presetTranslations(title: string): { en: string; fr: string } | null {
  const needle = title.trim().toLocaleLowerCase("cs");
  const preset = CHAPTER_PRESETS.find((p) => p.cs.toLocaleLowerCase("cs") === needle);
  return preset ? { en: preset.en, fr: preset.fr } : null;
}
