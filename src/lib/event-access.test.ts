import { describe, expect, it } from "vitest";
import type { PhotoStatus } from "@/generated/prisma/enums";
import { pickCover } from "./event-access";

// `resolveEvent` itself talks to Prisma directly (no mocking setup for that
// exists in this repo yet), so these tests cover the cover-choosing rule it
// shares with the admin overview — the part that decides which single photo
// represents a gallery everywhere it is shown as one tile.
describe("pickCover", () => {
  const photo = (status: PhotoStatus, objectKey: string) => ({ status, objectKey });
  const chosen = photo("CONFIRMED", "chosen.jpg");
  const newest = photo("CONFIRMED", "newest.jpg");

  it("prefers the photographer's chosen cover over the newest photo", () => {
    expect(pickCover(chosen, newest)).toBe(chosen);
  });

  it("falls back to the newest photo when no cover was chosen", () => {
    expect(pickCover(null, newest)).toBe(newest);
    expect(pickCover(undefined, newest)).toBe(newest);
  });

  it("falls back when the chosen photo never finished uploading", () => {
    expect(pickCover(photo("PENDING", "ghost.jpg"), newest)).toBe(newest);
  });

  it("returns null for a gallery with no photos at all", () => {
    expect(pickCover(null, undefined)).toBeNull();
    expect(pickCover(null, null)).toBeNull();
  });

  it("still returns the chosen cover when it is the only photo", () => {
    expect(pickCover(chosen, undefined)).toBe(chosen);
  });
});
