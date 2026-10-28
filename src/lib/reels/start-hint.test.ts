import { describe, expect, it } from "vitest";
import { startHint } from "@/lib/reels/start-hint";

describe("startHint", () => {
  it("names the song's own second for a file or a whole Instagram track", () => {
    expect(startHint({ kind: "file", decodedMs: 180_000 }, 62.4)).toBe("na 1:02");
    expect(startHint({ kind: "instagram", durationMs: 153_760, decodedMs: 153_700 }, 30)).toBe(
      "na 0:30",
    );
  });

  it("adds where a YouTube listening began", () => {
    expect(startHint({ kind: "listened", startAt: 60, decodedMs: 45_000 }, 12.4)).toBe(
      "zhruba na 1:12",
    );
  });

  it("says when it can only count from what was played", () => {
    expect(startHint({ kind: "listened", decodedMs: 45_000 }, 12.4)).toBe(
      "o 12 s za místo, odkud jsi ji pouštěl",
    );
  });

  it("warns that an Instagram excerpt is not the whole song", () => {
    expect(startHint({ kind: "instagram", durationMs: 153_760, decodedMs: 30_000 }, 8)).toBe(
      "na 0:08 ukázky (ukázka není celá písnička)",
    );
  });
});
