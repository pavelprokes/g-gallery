import { describe, expect, it } from "vitest";
import { newState, reelsWith, safeReturn, stateMatches } from "@/lib/instagram/oauth-state";

describe("state", () => {
  it("is long, random and compared exactly", () => {
    const a = newState();
    expect(a).toMatch(/^[\w-]{43}$/);
    expect(newState()).not.toBe(a);
    expect(stateMatches(a, a)).toBe(true);
    expect(stateMatches(a, `${a}x`)).toBe(false);
    expect(stateMatches(a, null)).toBe(false);
    expect(stateMatches(undefined, a)).toBe(false);
  });
});

describe("safeReturn", () => {
  it("allows the reels page with its galleries, nothing else", () => {
    expect(safeReturn("/admin/reels?g=abc,def")).toBe("/admin/reels?g=abc,def");
    expect(safeReturn("/admin/reels")).toBe("/admin/reels");
    for (const evil of [
      "https://evil.test/admin/reels",
      "//evil.test/admin/reels",
      "/admin/reels?g=a&next=https://evil.test",
      "/admin/g/123",
      "/admin/reels/../g",
      null,
    ]) {
      expect(safeReturn(evil)).toBe("/admin/reels");
    }
  });

  it("brings the outcome back on this site only", () => {
    expect(reelsWith("https://photos.test", "connected", "/admin/reels?g=a,b")).toBe(
      "https://photos.test/admin/reels?g=a%2Cb&instagram=connected",
    );
    expect(reelsWith("https://photos.test", "denied", "//evil.test")).toBe(
      "https://photos.test/admin/reels?instagram=denied",
    );
  });
});
