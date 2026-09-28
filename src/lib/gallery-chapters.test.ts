import { describe, expect, it } from "vitest";
import { chapterSlug, compareTimeline, presetTranslations } from "@/lib/gallery-chapters";

describe("chapterSlug", () => {
  it("uses a preset's English name, whatever language the link is opened in", () => {
    expect(chapterSlug("Obřad", [])).toBe("ceremony");
    expect(chapterSlug("První tanec", [])).toBe("first-dance");
  });

  it("transliterates a custom title to plain ASCII", () => {
    expect(chapterSlug("Rozbíjení talíře", [])).toBe("rozbijeni-talire");
  });

  it("numbers a second chapter with the same title", () => {
    expect(chapterSlug("Obřad", ["ceremony"])).toBe("ceremony-2");
    expect(chapterSlug("Obřad", ["ceremony", "ceremony-2"])).toBe("ceremony-3");
  });

  it("falls back when the title has nothing to slug", () => {
    expect(chapterSlug("❤️", [])).toBe("chapter");
  });
});

describe("presetTranslations", () => {
  it("matches a preset regardless of case and spacing", () => {
    expect(presetTranslations("  obřad ")).toEqual({ en: "Ceremony", fr: "Cérémonie" });
  });

  it("is null for a custom title", () => {
    expect(presetTranslations("Rozbíjení talíře")).toBeNull();
  });
});

describe("compareTimeline", () => {
  it("orders by time, then by id", () => {
    const a = { key: "2026-09-19T14:00:00.000Z", id: "b" };
    expect(compareTimeline(a, { ...a, key: "2026-09-19T14:01:00.000Z" })).toBe(-1);
    expect(compareTimeline(a, { ...a, id: "a" })).toBe(1);
    expect(compareTimeline(a, { ...a })).toBe(0);
  });

  it("orders file-name keys by their padded numbers, not their text", () => {
    // svatba_9.jpg and svatba_10.jpg, as the database keys them.
    const nine = { key: "svatba000000000009jpg", id: "z" };
    const ten = { key: "svatba000000000010jpg", id: "a" };
    expect(compareTimeline(nine, ten)).toBe(-1);
  });
});
