import { describe, expect, it } from "vitest";
import {
  generateShareToken,
  generateStoragePrefix,
  hashPassword,
  hashShareToken,
  verifyPassword,
} from "./share-token";

describe("share-token", () => {
  it("generates 128-bit base64url tokens", () => {
    const token = generateShareToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/); // 16 bytes -> 22 base64url chars
    expect(Buffer.from(token, "base64url")).toHaveLength(16);
  });

  it("generates distinct tokens", () => {
    const tokens = new Set(Array.from({ length: 100 }, generateShareToken));
    expect(tokens.size).toBe(100);
  });

  it("hashes tokens deterministically and irreversibly", () => {
    const token = generateShareToken();
    expect(hashShareToken(token)).toBe(hashShareToken(token));
    expect(hashShareToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashShareToken(token)).not.toContain(token);
    expect(hashShareToken(token)).not.toBe(hashShareToken(generateShareToken()));
  });

  it("round-trips a password", async () => {
    const stored = await hashPassword("svatba-2026");
    expect(stored).toMatch(/^[0-9a-f]{32}:[0-9a-f]{128}$/);
    await expect(verifyPassword("svatba-2026", stored)).resolves.toBe(true);
  });

  it("rejects a wrong password", async () => {
    const stored = await hashPassword("svatba-2026");
    await expect(verifyPassword("svatba-2025", stored)).resolves.toBe(false);
    await expect(verifyPassword("", stored)).resolves.toBe(false);
  });

  it("salts each hash independently", async () => {
    expect(await hashPassword("same")).not.toBe(await hashPassword("same"));
  });

  it("rejects malformed stored hashes instead of throwing", async () => {
    await expect(verifyPassword("x", "garbage")).resolves.toBe(false);
    await expect(verifyPassword("x", "")).resolves.toBe(false);
  });

  it("generates unguessable storage prefixes", () => {
    const prefix = generateStoragePrefix();
    expect(prefix).toMatch(/^galleries\/[0-9a-f]{32}$/);
    expect(generateStoragePrefix()).not.toBe(prefix);
  });
});
