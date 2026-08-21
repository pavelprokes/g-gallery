import { describe, expect, it } from "vitest";
import { czechPlural, FORMS, pluralize } from "./czech-plural";

describe("czechPlural", () => {
  it("uses the singular for exactly 1", () => {
    expect(czechPlural(1, FORMS.reaction)).toBe("reakce");
    expect(czechPlural(1, FORMS.viewer)).toBe("divák");
  });

  it("uses the paucal form for 2-4 — the form English-style code gets wrong", () => {
    for (const n of [2, 3, 4]) {
      expect(czechPlural(n, FORMS.reaction)).toBe("reakce");
      expect(czechPlural(n, FORMS.viewer)).toBe("diváci");
    }
  });

  it("uses the genitive plural for 5 and above", () => {
    for (const n of [5, 11, 100]) {
      expect(czechPlural(n, FORMS.reaction)).toBe("reakcí");
      expect(czechPlural(n, FORMS.viewer)).toBe("diváků");
    }
  });

  it("treats zero as many, not as one", () => {
    expect(czechPlural(0, FORMS.photo)).toBe("fotek");
  });

  it("handles words whose forms coincide", () => {
    // "stažení" is the same in all three; the helper must not invent variation.
    expect(pluralize(1, FORMS.download)).toBe("1 stažení");
    expect(pluralize(3, FORMS.download)).toBe("3 stažení");
    expect(pluralize(9, FORMS.download)).toBe("9 stažení");
  });

  it("declines into the accusative after a verb", () => {
    // "Stáhnout 1 fotka" is broken Czech; the verb takes the accusative.
    expect(pluralize(1, FORMS.photoAccusative)).toBe("1 fotku");
    expect(pluralize(3, FORMS.photoAccusative)).toBe("3 fotky");
    expect(pluralize(8, FORMS.photoAccusative)).toBe("8 fotek");
  });

  it("formats count and word together", () => {
    expect(pluralize(4, FORMS.reaction)).toBe("4 reakce");
    expect(pluralize(5, FORMS.reaction)).toBe("5 reakcí");
    expect(pluralize(2, FORMS.favorite)).toBe("2 oblíbené");
  });
});
