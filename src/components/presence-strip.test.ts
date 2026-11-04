import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import cs from "../../messages/cs.json";
import en from "../../messages/en.json";
import { presenceLabel } from "./presence-strip";

const tCs = createTranslator({ locale: "cs", messages: cs, namespace: "presence" });
const tEn = createTranslator({ locale: "en", messages: en, namespace: "presence" });

describe("presenceLabel", () => {
  it("joins names the locale's way", () => {
    expect(presenceLabel({ count: 2, names: ["Jana", "Petr"] }, "cs", tCs)).toBe(
      "Jana a\u00A0Petr se dívají",
    );
    expect(presenceLabel({ count: 3, names: ["Jana", "Petr", "Eva"] }, "en", tEn)).toBe(
      "Jana, Petr, and Eva are viewing",
    );
  });

  it("counts the viewers past the names, unnamed ones included", () => {
    expect(presenceLabel({ count: 4, names: ["Jana", "Petr"] }, "cs", tCs)).toBe(
      "Jana, Petr a\u00A0další 2 se dívají",
    );
    expect(presenceLabel({ count: 8, names: ["Jana", "Petr", "Eva", "Ota"] }, "cs", tCs)).toBe(
      "Jana, Petr, Eva a\u00A0dalších 5 se dívají",
    );
    expect(presenceLabel({ count: 2, names: ["Jana"] }, "en", tEn)).toBe(
      "Jana and 1 other are viewing",
    );
  });

  it("uses the singular for one named viewer alone", () => {
    expect(presenceLabel({ count: 1, names: ["Jana"] }, "cs", tCs)).toBe("Jana se dívá");
  });

  it("falls back to a count when nobody gave a name", () => {
    expect(presenceLabel({ count: 1, names: [] }, "cs", tCs)).toBe("Někdo se právě dívá");
    expect(presenceLabel({ count: 3, names: [] }, "en", tEn)).toBe(
      "3 people are viewing right now",
    );
  });
});
