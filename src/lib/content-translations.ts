import { z } from "zod";
import { DEFAULT_LOCALE, LOCALES, type Locale } from "@/i18n/locales";

/**
 * Translations of the text the photographer types into the admin — wedding
 * title and venue, gallery title, promo card copy (docs/I18N.md §Content).
 *
 * The model's own columns hold the original, written in Czech in a Czech
 * admin; each row carries one `translations` JSON object for the other
 * languages: `{ "en": { "title": "Ceremony" }, "fr": { "title": "Cérémonie" } }`.
 *
 * Client-safe on purpose (no server-only imports): the admin forms render the
 * same locale list and field names the server actions read back.
 */

/** The language of the columns themselves — what the admin's own fields hold. */
export const CONTENT_BASE_LOCALE = "cs" as const satisfies Locale;

export type TranslatedLocale = Exclude<Locale, typeof CONTENT_BASE_LOCALE>;

export const TRANSLATED_LOCALES = LOCALES.filter(
  (locale): locale is TranslatedLocale => locale !== CONTENT_BASE_LOCALE,
);

export type ContentTranslations<F extends string> = Partial<
  Record<TranslatedLocale, Partial<Record<F, string>>>
>;

/** The translatable fields of each model — what readers parse the JSON column for. */
export const EVENT_TRANSLATED_FIELDS = ["title", "venue"] as const;
export const GALLERY_TRANSLATED_FIELDS = ["title"] as const;
export const PROMO_TRANSLATED_FIELDS = ["eyebrow", "headline", "body", "ctaLabel"] as const;

function isTranslatedLocale(value: string): value is TranslatedLocale {
  return (TRANSLATED_LOCALES as readonly string[]).includes(value);
}

/**
 * Reads the column as stored. The database types it as bare JSON, so anything
 * unexpected — an unknown locale, an unknown field, a non-string, whitespace —
 * is dropped rather than trusted: the result is rendered into guests' pages.
 */
export function parseTranslations<F extends string>(
  raw: unknown,
  fields: readonly F[],
): ContentTranslations<F> {
  const result: ContentTranslations<F> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return result;

  for (const [locale, entry] of Object.entries(raw as Record<string, unknown>)) {
    if (!isTranslatedLocale(locale)) continue;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const clean: Partial<Record<F, string>> = {};
    for (const field of fields) {
      const value = (entry as Record<string, unknown>)[field];
      if (typeof value === "string" && value.trim()) clean[field] = value.trim();
    }
    if (Object.keys(clean).length > 0) result[locale] = clean;
  }
  return result;
}

/**
 * What a guest reading `locale` sees for one field.
 *
 * The chain is: their language → English → the Czech original. English sits in
 * the middle because it is the app's own fallback language (DEFAULT_LOCALE): a
 * French guest at a wedding where the photographer only wrote English
 * translations reads "Ceremony" far more easily than "Obřad". A Czech guest
 * always gets the original — the columns are Czech.
 */
export function localizeField<F extends string>(
  base: string,
  translations: ContentTranslations<F>,
  field: F,
  locale: Locale,
): string {
  return localizeOptionalField(base, translations, field, locale) ?? base;
}

/** The same for a field that may be empty in the original (venue, eyebrow…). */
export function localizeOptionalField<F extends string>(
  base: string | null,
  translations: ContentTranslations<F>,
  field: F,
  locale: Locale,
): string | null {
  if (locale === CONTENT_BASE_LOCALE) return base;
  const chain: TranslatedLocale[] = [locale];
  if (DEFAULT_LOCALE !== locale && DEFAULT_LOCALE !== CONTENT_BASE_LOCALE) {
    chain.push(DEFAULT_LOCALE);
  }
  for (const candidate of chain) {
    const value = translations[candidate]?.[field];
    if (value) return value;
  }
  return base;
}

/** One field in every language the app speaks — for a surface whose language is chosen on the page itself (the printable sign). */
export function localizeFieldForAll<F extends string>(
  base: string,
  translations: ContentTranslations<F>,
  field: F,
): Record<Locale, string> {
  return Object.fromEntries(
    LOCALES.map((locale) => [locale, localizeField(base, translations, field, locale)]),
  ) as Record<Locale, string>;
}

/** The form field that carries one translation — shared by the admin forms and the actions. */
export function translationFieldName(locale: TranslatedLocale, field: string): string {
  return `translations.${locale}.${field}`;
}

/**
 * Reads the translation inputs of an admin form. Every field is optional; an
 * empty one is simply absent from the result, so clearing a translation in the
 * form removes it and the guest falls back again. Over-length input is an
 * error, not a silent cut — same rule as the Czech fields next to it.
 */
export function readTranslationsFromForm<F extends string>(
  formData: FormData,
  maxLengths: Record<F, number>,
): { success: true; data: ContentTranslations<F> } | { success: false } {
  const data: ContentTranslations<F> = {};
  for (const locale of TRANSLATED_LOCALES) {
    const entry: Partial<Record<F, string>> = {};
    for (const field of Object.keys(maxLengths) as F[]) {
      const parsed = z
        .string()
        .trim()
        .max(maxLengths[field])
        .optional()
        .safeParse(formData.get(translationFieldName(locale, field)) ?? undefined);
      if (!parsed.success) return { success: false };
      if (parsed.data) entry[field] = parsed.data;
    }
    if (Object.keys(entry).length > 0) data[locale] = entry;
  }
  return { success: true, data };
}
