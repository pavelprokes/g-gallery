import type { Font } from "opentype.js";

/**
 * The couple's monogram (docs/ENGRAVING.md §Monogram): their initials around
 * an ampersand, "A&P", engraved at an exact physical width — 25 mm unless the
 * photographer types another. Cropped to the ink like the plate, so the width
 * asked for is the width of the letters themselves, not of a box around them.
 */

/** A small engraving needs the resolution a plate does not: 25 mm is 591 px here. */
export const MONOGRAM_DPI = 600;
export const DEFAULT_MONOGRAM_WIDTH_MM = 25;
export const MIN_MONOGRAM_WIDTH_MM = 5;
export const MAX_MONOGRAM_WIDTH_MM = 300;
/**
 * Air between the letters and the ampersand, in em. Set solid, a serif "A&P"
 * reads as one blot at 25 mm; a connected script keeps its joins instead.
 */
export const MONOGRAM_LETTER_SPACING = 0.06;
const MM_PER_INCH = 25.4;

/**
 * The first letter of a name, capitalised the Czech way. NFC first, so a name
 * typed with a combining háček ("Z" + U+030C) still gives one letter, "Ž".
 */
export function initialOf(name: string): string {
  const first = Array.from(name.normalize("NFC").trim())[0] ?? "";
  return first.toLocaleUpperCase("cs");
}

/** "A&P"; with one initial missing, just the other — never a lone ampersand. */
export function monogramText(first: string, second: string): string {
  return [first.trim(), second.trim()].filter(Boolean).join("&");
}

export function clampMonogramWidth(mm: number): number {
  if (!Number.isFinite(mm)) return DEFAULT_MONOGRAM_WIDTH_MM;
  return Math.min(MAX_MONOGRAM_WIDTH_MM, Math.max(MIN_MONOGRAM_WIDTH_MM, mm));
}

export type Monogram = {
  /** Outline, in pixels at `MONOGRAM_DPI`, with its ink touching every edge. */
  d: string;
  widthPx: number;
  heightPx: number;
  widthMm: number;
  heightMm: number;
};

/** The monogram scaled so its ink is exactly `widthMm` wide. `null` when there is nothing to engrave. */
export function layoutMonogram(input: {
  font: Font;
  text: string;
  widthMm: number;
  letterSpacing: number;
}): Monogram | null {
  if (!input.text.trim()) return null;
  const options = { kerning: true, letterSpacing: input.letterSpacing };
  // Kerning and letter spacing both scale with the size, so one measurement at
  // a reference size gives the factor for any width.
  const reference = 1000;
  const box = input.font.getPath(input.text, 0, 0, reference, options).getBoundingBox();
  const inkWidth = box.x2 - box.x1;
  if (!(inkWidth > 0)) return null;

  const widthMm = clampMonogramWidth(input.widthMm);
  const widthPx = (widthMm / MM_PER_INCH) * MONOGRAM_DPI;
  const scale = widthPx / inkWidth;
  const heightPx = (box.y2 - box.y1) * scale;
  const d = input.font
    .getPath(input.text, -box.x1 * scale, -box.y1 * scale, reference * scale, options)
    .toPathData(2);
  return { d, widthPx, heightPx, widthMm, heightMm: (heightPx / MONOGRAM_DPI) * MM_PER_INCH };
}

const num = (value: number, places = 2) => String(Math.round(value * 10 ** places) / 10 ** places);

/**
 * The monogram as SVG with its physical size in millimetres, so a laser
 * program imports it at 25 mm without being told. Outlines only, no
 * background — the same reasons as the plate (`plateSvg`).
 */
export function monogramSvg(monogram: Monogram): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" ` +
    `width="${num(monogram.widthMm, 3)}mm" height="${num(monogram.heightMm, 3)}mm" ` +
    `viewBox="0 0 ${num(monogram.widthPx)} ${num(monogram.heightPx)}">` +
    `<path id="monogram" fill="#000" d="${monogram.d}"/>` +
    `</svg>\n`
  );
}
