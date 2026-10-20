import fs from "node:fs";
import path from "node:path";
import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import { LOCALES } from "@/i18n/locales";

/** Every language's copy has the Czech keys, and every tool string formats in its own plural rules. */
const read = (code: string) =>
  JSON.parse(fs.readFileSync(path.join(__dirname, `slideshow.${code}.json`), "utf8")) as {
    page: Record<string, unknown>;
    tool: Record<string, unknown>;
  };

function shape(value: unknown, at = ""): string[] {
  if (Array.isArray(value))
    return [`${at}[${value.length}]`, ...value.flatMap((v, i) => shape(v, `${at}[${i}]`))];
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) => shape(v, at ? `${at}.${k}` : k));
  }
  return [at];
}

const VALUES = {
  done: 3,
  total: 10,
  min: 3,
  max: 60,
  name: "a.jpg",
  seconds: 15,
  minutes: 2,
  percent: 40,
};

describe("slideshow maker copy", () => {
  const czech = shape(read("cs")).sort();

  for (const code of LOCALES) {
    it(`${code} has every key and formats every count`, () => {
      const copy = read(code);
      expect(shape(copy).sort()).toEqual(czech);
      const errors: string[] = [];
      const t = createTranslator({
        locale: code,
        messages: { tool: copy.tool },
        namespace: "tool",
        onError: (error) => errors.push(error.message),
      });
      for (const [key, value] of Object.entries(copy.tool)) {
        if (typeof value !== "string") continue;
        for (const count of [0, 1, 2, 5, 22]) {
          const out = (t as unknown as (k: string, v: object) => string)(key, { ...VALUES, count });
          expect(out, key).not.toMatch(/[{}]/);
        }
      }
      expect(errors).toEqual([]);
      expect((copy.page.pageTitle as string).length).toBeLessThanOrEqual(70);
      expect((copy.page.pageDescription as string).length).toBeLessThanOrEqual(165);
    });
  }
});
