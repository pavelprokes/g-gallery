/**
 * The typefaces the engraving plate can be set in (docs/ENGRAVING.md §Fonts).
 * Every file is a static instance from Google Fonts, committed under
 * `public/vendor/engraving/fonts/` with its OFL licence, so the admin never asks
 * a third party for a font and the outlines in an export never depend on what
 * the photographer's machine has installed.
 */

export type EngravingFontId =
  "playfair-display" | "cormorant-garamond" | "bitter" | "lora" | "cinzel" | "great-vibes";

export type EngravingFont = {
  id: EngravingFontId;
  /** Shown in the picker. */
  label: string;
  /** The family name a `<text>` export asks for, as the font installs itself. */
  family: string;
  /** CSS weight of the committed instance. */
  weight: number;
  /** Path under `public/`. */
  file: string;
  /**
   * Optical correction on top of the metric match (same cap height as the
   * template): a script face's capitals are tall swashes over a tiny lowercase,
   * so matching cap heights alone sets it visibly smaller than the serifs.
   */
  namesScale: number;
  /** The date is set in another face where this one's figures do not engrave well. */
  dateFont?: EngravingFontId;
};

export const ENGRAVING_FONTS: readonly EngravingFont[] = [
  {
    id: "playfair-display",
    label: "Playfair Display (jako předloha)",
    family: "Playfair Display",
    weight: 500,
    file: "/vendor/engraving/fonts/playfair-display-500.ttf",
    namesScale: 1,
  },
  {
    id: "cormorant-garamond",
    label: "Cormorant Garamond",
    family: "Cormorant Garamond",
    weight: 600,
    file: "/vendor/engraving/fonts/cormorant-garamond-600.ttf",
    namesScale: 1,
  },
  {
    id: "lora",
    label: "Lora",
    family: "Lora",
    weight: 500,
    file: "/vendor/engraving/fonts/lora-500.ttf",
    namesScale: 1,
  },
  {
    id: "bitter",
    label: "Bitter (jako web)",
    family: "Bitter",
    weight: 500,
    file: "/vendor/engraving/fonts/bitter-500.ttf",
    namesScale: 1,
  },
  {
    id: "cinzel",
    label: "Cinzel (kapitálky)",
    family: "Cinzel",
    weight: 500,
    file: "/vendor/engraving/fonts/cinzel-500.ttf",
    namesScale: 0.9,
  },
  {
    id: "great-vibes",
    label: "Great Vibes (psací)",
    family: "Great Vibes",
    weight: 400,
    file: "/vendor/engraving/fonts/great-vibes-400.ttf",
    namesScale: 1.45,
    dateFont: "playfair-display",
  },
];

export const DEFAULT_ENGRAVING_FONT: EngravingFontId = "playfair-display";

export function engravingFont(id: string): EngravingFont {
  return ENGRAVING_FONTS.find((font) => font.id === id) ?? ENGRAVING_FONTS[0]!;
}
