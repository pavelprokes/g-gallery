import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse, type Font } from "opentype.js";
import { describe, expect, it } from "vitest";
import { ENGRAVING_FONTS, engravingFont } from "./fonts";
import {
  MONOGRAM_DPI,
  MONOGRAM_LETTER_SPACING,
  clampMonogramWidth,
  initialOf,
  layoutMonogram,
  monogramSvg,
  monogramText,
} from "./monogram";

function loadFont(file: string): Font {
  const bytes = readFileSync(join(process.cwd(), "public", file));
  return parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}

const playfair = loadFont(engravingFont("playfair-display").file);

describe("initialOf", () => {
  it("capitalises the first letter, háčky included", () => {
    expect(initialOf("  šárka")).toBe("Š");
    expect(initialOf("Patricie")).toBe("P");
  });

  it("keeps a decomposed háček on its letter", () => {
    expect(initialOf("Žofie")).toBe("Ž");
  });

  it("is empty for an empty name", () => {
    expect(initialOf("   ")).toBe("");
  });
});

describe("monogramText", () => {
  it("joins the initials with an ampersand", () => {
    expect(monogramText("A", "P")).toBe("A&P");
  });

  it("never leaves the ampersand alone", () => {
    expect(monogramText("A", " ")).toBe("A");
    expect(monogramText("", "")).toBe("");
  });
});

describe("layoutMonogram", () => {
  it("is exactly 25 mm wide, at 600 dpi", () => {
    const monogram = layoutMonogram({
      font: playfair,
      text: "A&P",
      widthMm: 25,
      letterSpacing: MONOGRAM_LETTER_SPACING,
    })!;
    expect(monogram.widthMm).toBe(25);
    expect(monogram.widthPx).toBeCloseTo((25 / 25.4) * MONOGRAM_DPI, 6);
    expect(monogram.heightMm).toBeGreaterThan(5);
    expect(monogram.heightMm).toBeLessThan(25);
  });

  it("puts the ink against every edge", () => {
    const monogram = layoutMonogram({
      font: playfair,
      text: "A&P",
      widthMm: 25,
      letterSpacing: MONOGRAM_LETTER_SPACING,
    })!;
    // Re-measure the outline itself: drawn from the path data, not the layout's own numbers.
    const box = playfair
      .getPath("A&P", 0, 0, 1000, { letterSpacing: MONOGRAM_LETTER_SPACING })
      .getBoundingBox();
    const scale = monogram.widthPx / (box.x2 - box.x1);
    expect(monogram.heightPx).toBeCloseTo((box.y2 - box.y1) * scale, 6);
    const xs = [...monogram.d.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(-0.01);
  });

  it("follows the width asked for, within limits", () => {
    const wide = layoutMonogram({ font: playfair, text: "A&P", widthMm: 50, letterSpacing: 0 })!;
    const narrow = layoutMonogram({ font: playfair, text: "A&P", widthMm: 25, letterSpacing: 0 })!;
    expect(wide.heightMm).toBeCloseTo(narrow.heightMm * 2, 6);
    expect(clampMonogramWidth(1)).toBe(5);
    expect(clampMonogramWidth(Number.NaN)).toBe(25);
  });

  it("is nothing without initials", () => {
    expect(layoutMonogram({ font: playfair, text: " ", widthMm: 25, letterSpacing: 0 })).toBeNull();
  });

  it.each(ENGRAVING_FONTS.map((font) => [font.id, font] as const))(
    "sets Czech initials in %s",
    (_id, meta) => {
      const font = loadFont(meta.file);
      const monogram = layoutMonogram({
        font,
        text: "Ž&Ř",
        widthMm: 25,
        letterSpacing: meta.script ? 0 : MONOGRAM_LETTER_SPACING,
      })!;
      expect(monogram.widthMm).toBe(25);
      expect(monogram.heightPx).toBeGreaterThan(0);
    },
  );
});

describe("monogramSvg", () => {
  it("carries its physical size in millimetres, outlines only", () => {
    const monogram = layoutMonogram({
      font: playfair,
      text: "A&P",
      widthMm: 25,
      letterSpacing: MONOGRAM_LETTER_SPACING,
    })!;
    const svg = monogramSvg(monogram);
    expect(svg).toContain('width="25mm"');
    expect(svg).toMatch(/height="\d+(\.\d+)?mm"/);
    expect(svg).toContain('viewBox="0 0 590.55 ');
    expect(svg).toContain('<path id="monogram" fill="#000" d="M');
    expect(svg).not.toContain("<text");
    expect(svg).not.toContain("<rect");
  });
});
