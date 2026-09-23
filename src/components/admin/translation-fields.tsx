import { useId } from "react";
import { Hint, Input, Label, Textarea } from "@/components/ui/input";
import {
  TRANSLATED_LOCALES,
  translationFieldName,
  type ContentTranslations,
  type TranslatedLocale,
} from "@/lib/content-translations";

/** Czech names, because the admin is Czech. A `Record` so a new locale fails typecheck here. */
const LANGUAGE_NAMES: Record<TranslatedLocale, string> = {
  en: "Anglicky",
  fr: "Francouzsky",
};

export interface TranslationFieldSpec<F extends string> {
  name: F;
  label: string;
  maxLength: number;
  multiline?: boolean;
  /** Shown as the placeholder: the Czech original, so the photographer sees what they translate. */
  original?: string | null;
}

/**
 * The guest-facing translations of an admin form's text fields
 * (docs/I18N.md §Content). Collapsed by default — most weddings are Czech and
 * the couple's names do not translate — and open by itself once anything has
 * been translated, so an existing translation is never hidden from the person
 * editing the original next to it.
 *
 * Uncontrolled inputs named by {@link translationFieldName}; the server
 * action reads them back with `readTranslationsFromForm`.
 */
export function TranslationFields<F extends string>({
  fields,
  values,
  note,
  className = "",
}: {
  fields: TranslationFieldSpec<F>[];
  values?: ContentTranslations<F>;
  /** One extra sentence for this form's hint — e.g. that couple names rarely need translating. */
  note?: string;
  className?: string;
}) {
  const idPrefix = useId();
  const hasAny = TRANSLATED_LOCALES.some((locale) => Object.keys(values?.[locale] ?? {}).length);

  return (
    <details open={hasAny} className={`rounded-lg border px-3 py-2 ${className}`}>
      <summary className="cursor-pointer text-sm font-semibold">
        Překlady pro hosty ({TRANSLATED_LOCALES.map((l) => l.toUpperCase()).join(", ")})
      </summary>
      <Hint>
        Uvidí je hosté, kterým se galerie zobrazí anglicky nebo francouzsky. Prázdné pole ukáže
        češtinu, francouzskému hostovi nejdřív angličtinu.{note ? ` ${note}` : ""}
      </Hint>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        {TRANSLATED_LOCALES.map((locale) => (
          <fieldset key={locale} lang={locale} className="space-y-3">
            <legend className="mb-1 text-sm font-semibold">{LANGUAGE_NAMES[locale]}</legend>
            {fields.map((field) => {
              const id = `${idPrefix}-${locale}-${field.name}`;
              const props = {
                id,
                name: translationFieldName(locale, field.name),
                maxLength: field.maxLength,
                defaultValue: values?.[locale]?.[field.name] ?? "",
                placeholder: field.original ?? undefined,
              };
              return (
                <div key={field.name}>
                  <Label htmlFor={id}>{field.label}</Label>
                  {field.multiline ? <Textarea rows={3} {...props} /> : <Input {...props} />}
                </div>
              );
            })}
          </fieldset>
        ))}
      </div>
    </details>
  );
}
