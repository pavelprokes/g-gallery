import { describe, expect, it } from "vitest";
import cs from "../../messages/cs.json";
import en from "../../messages/en.json";
import fr from "../../messages/fr.json";
import { UNLOCK_ATTEMPT_LIMIT, UNLOCK_LOCKOUT_MS } from "@/lib/share-access";
import { QUIET_PERIOD_MS } from "@/lib/zip-build-policy";
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
      if (depth === 1 && name && name !== "\0") args.add(`{${name}}`);
      depth -= 1;
      continue;
    }
    // Once the argument is named ("\0"), the rest of the group — including a
    // plural's second comma — is ignored.
    if (depth === 1 && name !== "\0") {
      if (char === "," && name) {
        args.add(`{${name}}`);
        name = "\0";
      } else {
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

  // The landing FAQ states the lockout as a number, because that is what an
  // answer engine quotes. If the constant changes, the copy has to follow.
  it("states the real password lockout in the landing FAQ", () => {
    const minutes = String(UNLOCK_LOCKOUT_MS / 60_000);
    expect(UNLOCK_ATTEMPT_LIMIT).toBe(5); // the copy spells it out as a word
    for (const locale of LOCALES) {
      const faq = (CATALOGS[locale] as { marketing: { faq: { a: string }[] } }).marketing.faq;
      const answer = faq.find((entry) => /\b(5|pěti|five|cinq)\b/.test(entry.a));
      expect(answer?.a, locale).toContain(`${minutes} min`);
    }
  });

  // "Usually within an hour of the last upload": the build waits out the quiet
  // period, then the 15-minute cron (vercel.json) picks it up. A longer quiet
  // period would make the landing FAQ's promise untrue.
  it("keeps the ZIP quiet period short enough for the FAQ's 'within an hour'", () => {
    const CRON_INTERVAL_MS = 15 * 60_000;
    expect(QUIET_PERIOD_MS + CRON_INTERVAL_MS).toBeLessThanOrEqual(45 * 60_000);
  });
});
