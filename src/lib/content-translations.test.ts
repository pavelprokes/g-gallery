import { describe, expect, it } from "vitest";
import {
  localizeField,
  localizeOptionalField,
  parseTranslations,
  readTranslationsFromForm,
  translationFieldName,
  TRANSLATED_LOCALES,
} from "./content-translations";

describe("parseTranslations", () => {
  it("keeps known locales and fields, trimmed", () => {
    expect(
      parseTranslations({ en: { title: "  Ceremony " }, fr: { title: "Cérémonie" } }, ["title"]),
    ).toEqual({ en: { title: "Ceremony" }, fr: { title: "Cérémonie" } });
  });

  it("drops what the database should never hold but might", () => {
    expect(
      parseTranslations(
        {
          cs: { title: "Obřad" }, // the original lives in the column, not here
          de: { title: "Zeremonie" }, // a language the app does not speak
          en: { title: "   ", venue: 42, extra: "x" },
          fr: "Cérémonie",
        },
        ["title", "venue"],
      ),
    ).toEqual({});
  });

  it("treats anything that is not an object as no translations", () => {
    for (const raw of [null, undefined, "x", 1, [], true]) {
      expect(parseTranslations(raw, ["title"])).toEqual({});
    }
  });
});

describe("localizeField", () => {
  const translations = { en: { title: "Ceremony" }, fr: { title: "Cérémonie" } };

  it("gives a Czech guest the original, whatever else exists", () => {
    expect(localizeField("Obřad", translations, "title", "cs")).toBe("Obřad");
  });

  it("gives each guest their own language when it exists", () => {
    expect(localizeField("Obřad", translations, "title", "en")).toBe("Ceremony");
    expect(localizeField("Obřad", translations, "title", "fr")).toBe("Cérémonie");
  });

  it("falls back from French to English before the Czech original", () => {
    expect(localizeField("Obřad", { en: { title: "Ceremony" } }, "title", "fr")).toBe("Ceremony");
  });

  it("falls back to the original when nothing is translated", () => {
    expect(localizeField("Anna & Petr", {}, "title", "fr")).toBe("Anna & Petr");
    expect(localizeField("Anna & Petr", { fr: { title: "Anna & Pierre" } }, "title", "en")).toBe(
      "Anna & Petr",
    );
  });
});

describe("localizeOptionalField", () => {
  it("keeps an empty original empty for a Czech guest", () => {
    expect(localizeOptionalField(null, { en: { venue: "Benice Farm" } }, "venue", "cs")).toBeNull();
  });

  it("lets a translation stand in for an empty original", () => {
    expect(localizeOptionalField(null, { en: { venue: "Benice Farm" } }, "venue", "fr")).toBe(
      "Benice Farm",
    );
  });
});

describe("readTranslationsFromForm", () => {
  function form(entries: Record<string, string>): FormData {
    const data = new FormData();
    for (const [key, value] of Object.entries(entries)) data.set(key, value);
    return data;
  }

  it("reads every translated locale and drops empty fields", () => {
    const result = readTranslationsFromForm(
      form({
        [translationFieldName("en", "title")]: " Ceremony ",
        [translationFieldName("en", "venue")]: "",
        [translationFieldName("fr", "title")]: "",
      }),
      { title: 200, venue: 200 },
    );
    expect(result).toEqual({ success: true, data: { en: { title: "Ceremony" } } });
  });

  it("rejects over-length input instead of cutting it", () => {
    const result = readTranslationsFromForm(
      form({ [translationFieldName("fr", "title")]: "x".repeat(201) }),
      { title: 200 },
    );
    expect(result.success).toBe(false);
  });

  it("covers every language except the Czech original", () => {
    expect(TRANSLATED_LOCALES).not.toContain("cs");
    expect(TRANSLATED_LOCALES.length).toBeGreaterThan(0);
  });
});
