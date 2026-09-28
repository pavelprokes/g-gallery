/**
 * Czech has three plural forms, not two: 1 takes the singular, 2–4 take a
 * distinct "paucal" form, and 5+ (plus 0) take the genitive plural. Formatting
 * with an English-style `n === 1 ? a : b` produces "4 reakcí", which reads as
 * broken Czech to every user of this app.
 */

export interface CzechForms {
  /** 1 — "reakce", "divák" */
  one: string;
  /** 2–4 — "reakce", "diváci" */
  few: string;
  /** 0 and 5+ — "reakcí", "diváků" */
  many: string;
}

export function czechPlural(count: number, forms: CzechForms): string {
  if (count === 1) return forms.one;
  if (count >= 2 && count <= 4) return forms.few;
  return forms.many;
}

/** `count` followed by the right form, e.g. `4 reakce`. */
export function pluralize(count: number, forms: CzechForms): string {
  return `${count} ${czechPlural(count, forms)}`;
}

export const FORMS = {
  viewer: { one: "divák", few: "diváci", many: "diváků" },
  reaction: { one: "reakce", few: "reakce", many: "reakcí" },
  favorite: { one: "oblíbená", few: "oblíbené", many: "oblíbených" },
  download: { one: "stažení", few: "stažení", many: "stažení" },
  photo: { one: "fotka", few: "fotky", many: "fotek" },
  gallery: { one: "galerie", few: "galerie", many: "galerií" },
  // Accusative: what follows a verb like "Stáhnout". Czech declines, so the
  // nominative set above reads as broken there ("Stáhnout 1 fotka").
  photoAccusative: { one: "fotku", few: "fotky", many: "fotek" },
  selected: { one: "vybraná", few: "vybrané", many: "vybraných" },
  day: { one: "den", few: "dny", many: "dní" },
  visit: { one: "návštěva", few: "návštěvy", many: "návštěv" },
  // The adjective declines with the noun, so the whole phrase is one form set.
  repeatVisit: {
    one: "opakovaná návštěva",
    few: "opakované návštěvy",
    many: "opakovaných návštěv",
  },
  upload: {
    one: "nedokončené nahrávání",
    few: "nedokončená nahrávání",
    many: "nedokončených nahrávání",
  },
} as const satisfies Record<string, CzechForms>;
