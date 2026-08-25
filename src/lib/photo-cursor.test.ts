import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor } from "./photo-cursor";

describe("photo cursor", () => {
  it("round-trips a cursor", () => {
    const takenAt = new Date("2026-08-12T10:30:00.000Z");
    const token = encodeCursor({ takenAt, id: "abc123" });
    const decoded = decodeCursor(token);
    expect(decoded).not.toBeNull();
    expect(decoded!.takenAt.toISOString()).toBe(takenAt.toISOString());
    expect(decoded!.id).toBe("abc123");
  });

  it("is opaque base64url, not a readable id", () => {
    const token = encodeCursor({ takenAt: new Date(), id: "abc123" });
    expect(token).not.toContain("abc123");
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("rejects garbage without throwing", () => {
    for (const bad of ["", "not-base64!!!", "e30=", Buffer.from("{}").toString("base64url")]) {
      expect(decodeCursor(bad)).toBeNull();
    }
  });

  it("rejects a cursor with a missing field", () => {
    const token = Buffer.from(JSON.stringify({ takenAt: new Date().toISOString() })).toString(
      "base64url",
    );
    expect(decodeCursor(token)).toBeNull();
  });

  it("rejects a cursor with an invalid date", () => {
    const token = Buffer.from(JSON.stringify({ takenAt: "not-a-date", id: "x" })).toString(
      "base64url",
    );
    expect(decodeCursor(token)).toBeNull();
  });
});
