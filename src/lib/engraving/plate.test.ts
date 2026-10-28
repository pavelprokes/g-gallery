import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse, type Font } from "opentype.js";
import { describe, expect, it } from "vitest";
import { ENGRAVING_FONTS, engravingFont } from "./fonts";
import {
  MAX_TEXT_WIDTH,
  coupleLine,
  framePathData,
  layoutPlate,
  parseCouple,
  plateDate,
  plateSvg,
  setJpegDpi,
} from "./plate";

const PUBLIC = join(process.cwd(), "public");

function loadFont(file: string): Font {
  const bytes = readFileSync(join(PUBLIC, file));
  return parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}

const playfair = loadFont(engravingFont("playfair-display").file);

function inkBox(font: Font, line: { text: string; x: number; baseline: number; size: number }) {
  return font.getPath(line.text, line.x, line.baseline, line.size).getBoundingBox();
}

describe("parseCouple", () => {
  it("splits a wedding title", () => {
    expect(parseCouple("Alice a Martin")).toEqual({
      first: "Alice",
      joiner: "a",
      second: "Martin",
    });
  });

  it("drops the venue a gallery title carries", () => {
    expect(parseCouple("Alice a Martin, Zámek Úsobí, 1. set")).toEqual({
      first: "Alice",
      joiner: "a",
      second: "Martin",
    });
  });

  it("keeps an ampersand", () => {
    expect(parseCouple("Terka & Matěj")).toEqual({ first: "Terka", joiner: "&", second: "Matěj" });
  });

  it("splits on the first joiner, so a double name stays whole", () => {
    expect(parseCouple("Anna Marie a Jan")).toEqual({
      first: "Anna Marie",
      joiner: "a",
      second: "Jan",
    });
  });

  it("keeps a title it cannot split as the first name", () => {
    expect(parseCouple("Pavlovi fotky z mobilu")).toEqual({
      first: "Pavlovi fotky z mobilu",
      joiner: "a",
      second: "",
    });
  });
});

describe("coupleLine", () => {
  it("joins both names", () => {
    expect(coupleLine({ first: "Alice", joiner: "&", second: "Martin" })).toBe("Alice & Martin");
  });

  it("leaves no dangling joiner with one name", () => {
    expect(coupleLine({ first: "Alice", joiner: "a", second: " " })).toBe("Alice");
  });
});

describe("plateDate", () => {
  it("writes the Czech form without leading zeros", () => {
    expect(plateDate("2026-08-02")).toBe("2. 8. 2026");
  });

  it("is empty without a date", () => {
    expect(plateDate(null)).toBe("");
  });
});

describe("layoutPlate", () => {
  const template = layoutPlate({
    namesFont: playfair,
    dateFont: playfair,
    names: "Alice a Martin",
    date: "22. 8. 2026",
    uppercase: false,
    namesScale: 1,
    fontNamesScale: 1,
  });

  // Measured on the photographer's own export of the same plate: names ink
  // x 447–1254, y 858–960; date ink x 677–1024, y 1043–1099 — on the plate,
  // less the crop's corner (203, 312).
  it("reproduces the photographer's Affinity export in Playfair", () => {
    expect(template.names!.size).toBeCloseTo(128, 1);
    expect(template.names!.baseline).toBeCloseTo(958 - 312, 1);
    expect(template.date!.size).toBeCloseTo(76, 1);
    expect(template.date!.baseline).toBeCloseTo(1098 - 312, 1);

    const names = inkBox(playfair, template.names!);
    expect(Math.abs(names.x1 - (447 - 203))).toBeLessThan(4);
    expect(Math.abs(names.x2 - (1254 - 203))).toBeLessThan(4);
    const date = inkBox(playfair, template.date!);
    expect(Math.abs(date.x1 - (677 - 203))).toBeLessThan(4);
    expect(Math.abs(date.x2 - (1024 - 203))).toBeLessThan(4);
  });

  it("centres each line on its ink", () => {
    for (const line of [template.names!, template.date!]) {
      const box = inkBox(playfair, line);
      expect((box.x1 + box.x2) / 2).toBeCloseTo(851 - 203, 0);
    }
  });

  it("shrinks names that would run past the lines", () => {
    const long = layoutPlate({
      namesFont: playfair,
      dateFont: playfair,
      names: "Maxmiliána Šťastná a Bartoloměj Vondráček",
      date: "22. 8. 2026",
      uppercase: false,
      namesScale: 1,
      fontNamesScale: 1,
    });
    const box = inkBox(playfair, long.names!);
    expect(box.x2 - box.x1).toBeLessThanOrEqual(MAX_TEXT_WIDTH + 0.5);
    expect(long.names!.size).toBeLessThan(128);
  });

  it("sets capitals in Czech, háčky included", () => {
    const caps = layoutPlate({
      namesFont: playfair,
      dateFont: playfair,
      names: "Terka & Matěj",
      date: "",
      uppercase: true,
      namesScale: 1,
      fontNamesScale: 1,
    });
    expect(caps.names!.text).toBe("TERKA & MATĚJ");
    expect(caps.date).toBeNull();
  });

  it("leaves out an empty line", () => {
    const onlyDate = layoutPlate({
      namesFont: playfair,
      dateFont: playfair,
      names: "  ",
      date: "22. 8. 2026",
      uppercase: false,
      namesScale: 1,
      fontNamesScale: 1,
    });
    expect(onlyDate.names).toBeNull();
    expect(onlyDate.date).not.toBeNull();
  });

  it.each(ENGRAVING_FONTS.map((font) => [font.id, font] as const))(
    "sets Czech names in %s between the lines",
    (_id, meta) => {
      const font = loadFont(meta.file);
      const dateFont = meta.dateFont ? loadFont(engravingFont(meta.dateFont).file) : font;
      for (const char of "ěščřžýáíéůúňťďĚŠČŘŽÝÁÍÉŮÚŇŤĎ&") {
        expect(font.charToGlyph(char).index, char).not.toBe(0);
      }
      const layout = layoutPlate({
        namesFont: font,
        dateFont,
        names: "Kateřina & Jiří",
        date: "22. 8. 2026",
        uppercase: false,
        namesScale: 1,
        fontNamesScale: meta.namesScale,
      });
      const names = inkBox(font, layout.names!);
      const date = inkBox(dateFont, layout.date!);
      // Inside the band between the lines (y 451–876 on the plate), names above the date.
      expect(names.y1).toBeGreaterThan(451);
      expect(names.y2).toBeLessThan(date.y1);
      expect(date.y2).toBeLessThan(876);
      // Edge to edge: nothing may be cut off by the crop.
      expect(names.x1).toBeGreaterThan(0);
      expect(names.x2).toBeLessThan(1296);
    },
  );
});

describe("plateSvg", () => {
  const layout = layoutPlate({
    namesFont: playfair,
    dateFont: playfair,
    names: "Alice <a> Martin",
    date: "22. 8. 2026",
    uppercase: false,
    namesScale: 1,
    fontNamesScale: 1,
  });

  it("outlines the text and keeps the frame", () => {
    const svg = plateSvg(layout, "M0 0h1v1z");
    expect(svg).toContain('width="1296" height="1193" viewBox="0 0 1296 1193"');
    expect(svg).toContain('<path id="ramecek" d="M0 0h1v1z"/>');
    expect(svg).toContain('<path id="jmena" d="M');
    expect(svg).not.toContain("<text");
    expect(svg).not.toContain("<rect");
  });

  it("escapes live text", () => {
    const family = { family: "Playfair Display", weight: 500 };
    const svg = plateSvg(layout, "M0 0z", "text", { names: family, date: family });
    expect(svg).toContain("Alice &lt;a&gt; Martin</text>");
    expect(svg).toContain('font-family="Playfair Display" font-weight="500"');
  });

  it("reads the committed frame, drawn in the plate's own coordinates", () => {
    const svg = readFileSync(join(PUBLIC, "vendor/engraving/leaf-frame.svg"), "utf8");
    expect(svg).toContain('viewBox="0 0 1296 1193"');
    const d = framePathData(svg);
    expect(d.startsWith("M")).toBe(true);
    expect(d.length).toBeGreaterThan(10_000);
  });
});

describe("setJpegDpi", () => {
  const jfif = Uint8Array.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
    0x00, 0x01, 0x00, 0x00,
  ]);

  it("writes dots per inch into the JFIF header", () => {
    const out = setJpegDpi(jfif, 144);
    expect([...out.subarray(13, 18)]).toEqual([1, 0, 144, 0, 144]);
    expect(jfif[13]).toBe(0);
  });

  it("leaves anything else alone", () => {
    const exif = Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, ...new Array(20).fill(0)]);
    expect(setJpegDpi(exif, 144)).toBe(exif);
  });
});
