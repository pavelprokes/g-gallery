import { describe, expect, it } from "vitest";
import cs from "../../messages/cs.json";
import en from "../../messages/en.json";
import fr from "../../messages/fr.json";
import { LOCALES, type Locale } from "./locales";

const CATALOGS: Record<Locale, unknown> = { cs, en, fr };

function keyPaths(value: unknown, prefix = ""): string[] {
  if (Array.isArray(value)) {
    // Arrays are treated as opaque data (e.g. the marketing FAQ list) — only
    // their presence is checked, not per-item shape.
    return [prefix];
  }
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
      keyPaths(child, prefix ? `${prefix}.${key}` : key),
    );
  }
  return [prefix];
}

function leafAt(value: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((node, key) => {
    return node && typeof node === "object" ? (node as Record<string, unknown>)[key] : undefined;
  }, value);
}

/**
 * The ICU arguments (`{count}`, `{size}`) and rich-text tags (`<a>…</a>`) a
 * message needs. A translation that drops one renders a literal "{size}" or
 * throws at runtime — and a catalog is the one file no type check reaches.
 *
 * Only top-level `{…}` groups are arguments; the `{…}` inside a plural are its
 * branches ("one {# photo}"), whose wording is exactly what differs per
 * language.
 */
function placeholders(message: string): string[] {
  const args = new Set<string>();
  let depth = 0;
  let name = "";
  for (const char of message) {
    if (char === "{") {
      depth += 1;
      if (depth === 1) name = "";
      continue;
    }
    if (char === "}") {
      if (depth === 1 && name) args.add(`{${name}}`);
      depth -= 1;
      continue;
    }
    if (depth === 1) {
      if (char === "," && name) {
        args.add(`{${name}}`);
        name = "\0"; // Argument named; ignore the rest of the group.
      } else if (name !== "\0") {
        name += char.trim();
      }
    }
  }
  const tags = [...message.matchAll(/<(\w+)>/g)].map((m) => `<${m[1]}>`);
  return [...new Set([...args, ...tags])].sort();
}

describe("message catalogs", () => {
  it("every locale in LOCALES has a catalog", () => {
    for (const locale of LOCALES) {
      expect(CATALOGS[locale], `messages/${locale}.json`).toBeTruthy();
    }
  });

  const reference: Locale = "cs";
  const referenceKeys = keyPaths(CATALOGS[reference]);

  for (const locale of LOCALES.filter((l) => l !== reference)) {
    it(`${locale}.json declares the same set of keys as ${reference}.json`, () => {
      const keys = new Set(keyPaths(CATALOGS[locale]));
      const refKeys = new Set(referenceKeys);

      const missing = [...refKeys].filter((key) => !keys.has(key));
      const extra = [...keys].filter((key) => !refKeys.has(key));

      expect(missing, `keys present in ${reference}.json but missing from ${locale}.json`).toEqual(
        [],
      );
      expect(extra, `keys present in ${locale}.json but missing from ${reference}.json`).toEqual(
        [],
      );
    });

    it(`${locale}.json keeps every placeholder and rich-text tag of ${reference}.json`, () => {
      const mismatches: string[] = [];
      for (const key of referenceKeys) {
        const ref = leafAt(CATALOGS[reference], key);
        const translated = leafAt(CATALOGS[locale], key);
        if (typeof ref !== "string" || typeof translated !== "string") continue;
        const expected = placeholders(ref);
        const actual = placeholders(translated);
        if (expected.join(" ") !== actual.join(" ")) {
          mismatches.push(
            `${key}: expected ${expected.join(" ")} — got ${actual.join(" ") || "∅"}`,
          );
        }
      }
      expect(mismatches).toEqual([]);
    });
  }

  it("names every language, in that language, for the switcher", () => {
    for (const locale of LOCALES) {
      const names = (CATALOGS[locale] as { localeSwitcher: Record<string, string> }).localeSwitcher;
      expect(Object.keys(names).sort()).toEqual([...LOCALES].sort());
    }
    // The endonyms are the same in every catalog on purpose — a French
    // speaker looking for their language on a Czech page must see "Français".
    const endonyms = LOCALES.map(
      (l) => (CATALOGS[l] as { localeSwitcher: Record<string, string> }).localeSwitcher,
    );
    for (const names of endonyms) expect(names).toEqual(endonyms[0]);
  });
});
