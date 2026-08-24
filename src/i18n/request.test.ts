import { describe, expect, it } from "vitest";
import { negotiateLocale } from "./request";

describe("negotiateLocale", () => {
  it("falls back to cs when there is no Accept-Language header", () => {
    expect(negotiateLocale(null)).toBe("cs");
  });

  it("picks en when the browser prefers English", () => {
    expect(negotiateLocale("en-US,en;q=0.9")).toBe("en");
  });

  it("picks cs when the browser prefers Czech", () => {
    expect(negotiateLocale("cs-CZ,cs;q=0.9,en;q=0.8")).toBe("cs");
  });

  it("falls back to cs for an unsupported language", () => {
    expect(negotiateLocale("de-DE,de;q=0.9")).toBe("cs");
  });
});
