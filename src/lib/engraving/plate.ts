import type { Font } from "opentype.js";

/**
 * The engraving plate (docs/ENGRAVING.md): the photographer's leaf frame with
 * the couple's names and the date set between its two lines.
 *
 * Every number here is measured from the photographer's own Affinity file
 * (`TM_2025_12x-100.af`, the "Alice a Martin" export): a 1702 × 1815 px canvas
 * at 144 dpi, names in Playfair Display Medium at 128 px on a baseline at
 * y = 958, the date at 76 px on y = 1098, both centred on their ink at x = 851.
 * Set in Playfair, the generator reproduces that export to the pixel; other
 * faces keep its cap height, its figure height and its gap, so the block sits
 * in the same place whichever face is picked.
 *
 * The plate itself is that canvas cropped to the frame's ink — the photographer
 * wanted the image edge to edge, with no white around it — so every template
 * measurement is shifted by the crop's corner, `TEMPLATE_CROP_X/Y`.
 */

/** Where the frame's ink starts on the template canvas: the lines' left end, the top leaf's tip. */
const TEMPLATE_CROP_X = 203;
const TEMPLATE_CROP_Y = 312;
/** The lines' right end (1499) and the lowest leaf's tip (1504.25) on the template, less the corner. */
export const PLATE_WIDTH = 1296;
export const PLATE_HEIGHT = 1193;
/** The source JPEG's resolution — the JPG export carries it so the size reads the same. */
export const PLATE_DPI = 144;

const CENTER_X = 851 - TEMPLATE_CROP_X;
/** Playfair Display Medium at the template's 128 px: 0.708 em cap height. */
const NAMES_CAP_HEIGHT = 128 * 0.708;
/** Playfair's old-style 8 at the template's 76 px: 0.722 em. */
const DATE_FIGURE_HEIGHT = 76 * 0.722;
const NAMES_BASELINE = 958 - TEMPLATE_CROP_Y;
const DATE_BASELINE = 1098 - TEMPLATE_CROP_Y;
/** From the names' baseline to the top of the date's tallest figure. */
const GAP = DATE_BASELINE - DATE_FIGURE_HEIGHT - NAMES_BASELINE;
/** Middle of the block (cap top of the names → baseline of the date). */
const BLOCK_CENTER_Y = (NAMES_BASELINE - NAMES_CAP_HEIGHT + DATE_BASELINE) / 2;
/**
 * The lines run the plate's full width; text wider than this would crowd their ends.
 * Long names shrink to fit rather than run off the plate.
 */
export const MAX_TEXT_WIDTH = 1180;
/**
 * Capitals at the lowercase setting's size shout. The photographer's earlier
 * all-caps plate ("TERKA & MATĚJ") had a 76 px cap height against 90.6 here.
 */
const UPPERCASE_SCALE = 0.84;

export type Couple = { first: string; joiner: string; second: string };

export const JOINERS = ["a", "&"] as const;

/**
 * "Alice a Martin" → Alice / a / Martin. A gallery's title carries the venue
 * after a comma ("Alice a Martin, Zámek Úsobí, 1. set") — that part is dropped.
 * A title that does not split is kept whole as the first name, for the
 * photographer to fix by hand rather than guessed at.
 */
export function parseCouple(title: string): Couple {
  const head = (title.split(",")[0] ?? "").trim().replace(/\s+/g, " ");
  const match = /^(.+?)\s+(a|&|\+)\s+(.+)$/i.exec(head);
  if (!match) return { first: head, joiner: "a", second: "" };
  const joiner = match[2]!.toLowerCase() === "a" ? "a" : "&";
  return { first: match[1]!.trim(), joiner, second: match[3]!.trim() };
}

/** The names line; with one name missing it is just the other, without a dangling "a". */
export function coupleLine({ first, joiner, second }: Couple): string {
  const names = [first.trim(), second.trim()].filter(Boolean);
  return names.join(` ${joiner.trim() || "a"} `);
}

/** "22. 8. 2026" — the Czech form the template uses, figures and all. */
export function plateDate(isoDate: string | null): string {
  const match = isoDate ? /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate) : null;
  if (!match) return "";
  return `${Number(match[3])}. ${Number(match[2])}. ${match[1]}`;
}

export type PlacedLine = {
  text: string;
  /** Outline of the line in plate coordinates, ready for a `<path d>`. */
  d: string;
  /** Where the `<text>` export starts the line (left of the first glyph's origin). */
  x: number;
  baseline: number;
  size: number;
  letterSpacing: number;
};

export type PlateLayout = { names: PlacedLine | null; date: PlacedLine | null };

export type PlateInput = {
  namesFont: Font;
  dateFont: Font;
  names: string;
  date: string;
  uppercase: boolean;
  /** The photographer's size adjustment for the names, 1 = template. */
  namesScale: number;
  /** The face's own optical correction (`EngravingFont.namesScale`). */
  fontNamesScale: number;
};

/** Height of a glyph's top above the baseline, in em. */
function glyphTop(font: Font, char: string, fallback: number): number {
  const glyph = font.charToGlyph(char);
  if (!glyph || glyph.index === 0) return fallback;
  const box = glyph.getBoundingBox();
  return box.y2 / font.unitsPerEm;
}

/**
 * One line centred on its ink at `CENTER_X`, shrunk to `MAX_TEXT_WIDTH` if it
 * would not fit. Returns `null` for a line with nothing to engrave.
 */
function placeLine(
  font: Font,
  text: string,
  size: number,
  letterSpacing: number,
): Omit<PlacedLine, "baseline" | "d"> | null {
  if (!text.trim()) return null;
  const options = { kerning: true, letterSpacing };
  let box = font.getPath(text, 0, 0, size, options).getBoundingBox();
  let width = box.x2 - box.x1;
  if (!(width > 0)) return null;
  if (width > MAX_TEXT_WIDTH) {
    size *= MAX_TEXT_WIDTH / width;
    box = font.getPath(text, 0, 0, size, options).getBoundingBox();
    width = box.x2 - box.x1;
  }
  return { text, x: CENTER_X - (box.x1 + box.x2) / 2, size, letterSpacing };
}

export function layoutPlate(input: PlateInput): PlateLayout {
  const namesText = input.uppercase ? input.names.toLocaleUpperCase("cs") : input.names;
  const capHeight = glyphTop(input.namesFont, "H", 0.7);
  const figureHeight = glyphTop(input.dateFont, "8", 0.72);

  const namesSize =
    (NAMES_CAP_HEIGHT / capHeight) *
    input.fontNamesScale *
    input.namesScale *
    (input.uppercase ? UPPERCASE_SCALE : 1);
  const names = placeLine(input.namesFont, namesText.trim(), namesSize, 0);
  const date = placeLine(input.dateFont, input.date.trim(), DATE_FIGURE_HEIGHT / figureHeight, 0);

  // The block is the names' cap height, the gap and the date's figure height,
  // centred where the template's block sits. A missing line leaves the other
  // one centred on its own.
  const namesCap = names ? capHeight * names.size : 0;
  const dateFigure = date ? figureHeight * date.size : 0;
  const block = namesCap + (names && date ? GAP : 0) + dateFigure;
  const top = BLOCK_CENTER_Y - block / 2;
  const namesBaseline = top + namesCap;
  const dateBaseline = names ? namesBaseline + GAP + dateFigure : top + dateFigure;

  const finish = (
    font: Font,
    line: Omit<PlacedLine, "baseline" | "d"> | null,
    baseline: number,
  ): PlacedLine | null =>
    line && {
      ...line,
      baseline,
      d: font
        .getPath(line.text, line.x, baseline, line.size, {
          kerning: true,
          letterSpacing: line.letterSpacing,
        })
        .toPathData(2),
    };

  return {
    names: finish(input.namesFont, names, namesBaseline),
    date: finish(input.dateFont, date, dateBaseline),
  };
}

/** The leaf frame's outline out of its committed SVG (`public/vendor/engraving/leaf-frame.svg`). */
export function framePathData(svg: string): string {
  const match = /<path[^>]*\sd="([^"]+)"/.exec(svg);
  if (!match) throw new Error("leaf-frame.svg has no path");
  return match[1]!;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const num = (value: number) => String(Math.round(value * 100) / 100);

export type TextFamily = { family: string; weight: number };

/**
 * The plate as SVG. `outlines` (the default, and what a laser wants) turns the
 * text into paths, so the file engraves the same on a machine without the
 * font. `text` keeps live `<text>` for editing in Affinity — it needs the font
 * installed, and is positioned with the same numbers as the outlines.
 *
 * No background: an engraving program would burn a white rectangle as a
 * filled shape. The JPG export lays the plate on white itself.
 */
export function plateSvg(
  layout: PlateLayout,
  frameD: string,
  mode: "outlines" | "text" = "outlines",
  families?: { names: TextFamily; date: TextFamily },
): string {
  const line = (id: string, placed: PlacedLine | null, family: TextFamily | undefined) => {
    if (!placed) return "";
    if (mode === "outlines" || !family) return `<path id="${id}" d="${placed.d}"/>`;
    const spacing = placed.letterSpacing
      ? ` letter-spacing="${num(placed.letterSpacing * placed.size)}"`
      : "";
    return (
      `<text id="${id}" x="${num(placed.x)}" y="${num(placed.baseline)}" ` +
      `font-family="${escapeXml(family.family)}" font-weight="${family.weight}" ` +
      `font-size="${num(placed.size)}" font-kerning="normal"${spacing}>` +
      `${escapeXml(placed.text)}</text>`
    );
  };
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${PLATE_WIDTH}" height="${PLATE_HEIGHT}" ` +
    `viewBox="0 0 ${PLATE_WIDTH} ${PLATE_HEIGHT}">` +
    `<g fill="#000">` +
    `<path id="ramecek" d="${frameD}"/>` +
    line("jmena", layout.names, families?.names) +
    line("datum", layout.date, families?.date) +
    `</g></svg>\n`
  );
}

/**
 * Stamp a resolution into a JPEG's JFIF header. A canvas encodes no density
 * (units 0, 1:1), which programs read as 72 dpi — the plate would import at
 * twice the template's physical size. Bytes without a JFIF APP0 come back as
 * they were.
 */
export function setJpegDpi(jpeg: Uint8Array, dpi: number): Uint8Array {
  const isJfif =
    jpeg.length > 18 &&
    jpeg[0] === 0xff &&
    jpeg[1] === 0xd8 &&
    jpeg[2] === 0xff &&
    jpeg[3] === 0xe0 &&
    String.fromCharCode(...jpeg.subarray(6, 11)) === "JFIF\0";
  if (!isJfif) return jpeg;
  const out = new Uint8Array(jpeg);
  out[13] = 1; // dots per inch
  out[14] = (dpi >> 8) & 0xff;
  out[15] = dpi & 0xff;
  out[16] = (dpi >> 8) & 0xff;
  out[17] = dpi & 0xff;
  return out;
}
