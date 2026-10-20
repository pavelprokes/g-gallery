import { describe, expect, it } from "vitest";
import { guidePath } from "./guide-path";

describe("guidePath", () => {
  it("sends Czech and Slovak readers to the Czech guide", () => {
    expect(guidePath("cs")).toBe("/navod");
    expect(guidePath("sk")).toBe("/navod");
  });

  it("sends everyone else to the English guide", () => {
    for (const locale of ["en", "de", "fr", "es", "pl"] as const) {
      expect(guidePath(locale)).toBe("/guide");
    }
  });
});
