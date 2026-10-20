import { describe, expect, it } from "vitest";
import { LOCALES } from "@/i18n/locales";
import { GUIDE_PATHS, guidePath } from "./guide-path";

describe("guidePath", () => {
  it("keeps the addresses Czech and English were published under", () => {
    expect(guidePath("cs")).toBe("/navod");
    expect(guidePath("en")).toBe("/guide");
  });

  it("gives every language its own address", () => {
    expect(new Set(LOCALES.map(guidePath)).size).toBe(LOCALES.length);
    expect(guidePath("sk")).toBe("/guide/sk");
    expect(Object.keys(GUIDE_PATHS).sort()).toEqual([...LOCALES].sort());
  });
});
