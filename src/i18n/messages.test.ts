import { describe, expect, it } from "vitest";
import cs from "../../messages/cs.json";
import en from "../../messages/en.json";

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

describe("message catalogs", () => {
  it("cs.json and en.json declare the same set of keys", () => {
    const csKeys = new Set(keyPaths(cs));
    const enKeys = new Set(keyPaths(en));

    const missingFromEn = [...csKeys].filter((key) => !enKeys.has(key));
    const missingFromCs = [...enKeys].filter((key) => !csKeys.has(key));

    expect(missingFromEn, "keys present in cs.json but missing from en.json").toEqual([]);
    expect(missingFromCs, "keys present in en.json but missing from cs.json").toEqual([]);
  });
});
