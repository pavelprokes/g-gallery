import { afterEach, describe, expect, it, vi } from "vitest";
import { decryptToken, encryptToken, tokenCipherConfigured } from "./token-cipher";

// 32 bytes, base64 — the shape `openssl rand -base64 32` produces.
const KEY = Buffer.alloc(32, 7).toString("base64");
const OTHER_KEY = Buffer.alloc(32, 9).toString("base64");

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("token cipher", () => {
  it("round-trips a token", () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", KEY);
    const stored = encryptToken("-va8I3IzPVLyNLDnfcyS_Q");
    expect(stored).toMatch(/^v1\./);
    expect(decryptToken(stored)).toBe("-va8I3IzPVLyNLDnfcyS_Q");
  });

  it("produces a different ciphertext every time — the nonce is fresh", () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", KEY);
    const a = encryptToken("same-token");
    const b = encryptToken("same-token");
    expect(a).not.toBe(b);
    expect(decryptToken(a)).toBe(decryptToken(b));
  });

  it("degrades to null without a key instead of throwing", () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", "");
    expect(tokenCipherConfigured()).toBe(false);
    expect(encryptToken("tok")).toBeNull();
    expect(decryptToken("v1.aaaa.bbbb")).toBeNull();
  });

  it("refuses a key of the wrong length rather than weakening silently", () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", Buffer.alloc(16, 1).toString("base64"));
    expect(() => encryptToken("tok")).toThrow(/32 bytes/);
  });

  it("returns null for a value encrypted under a different key", () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", KEY);
    const stored = encryptToken("tok");
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", OTHER_KEY);
    expect(decryptToken(stored)).toBeNull();
  });

  it("detects tampering — GCM authenticates, so it fails rather than decrypting garbage", () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", KEY);
    const stored = encryptToken("tok")!;
    const [version, iv, body] = stored.split(".");
    const flipped = `${body!.slice(0, -2)}${body!.slice(-2) === "AA" ? "AB" : "AA"}`;
    expect(decryptToken(`${version}.${iv}.${flipped}`)).toBeNull();
  });

  it("returns null for rows that predate the ciphertext, and for junk", () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", KEY);
    expect(decryptToken(null)).toBeNull();
    expect(decryptToken(undefined)).toBeNull();
    expect(decryptToken("")).toBeNull();
    expect(decryptToken("v2.aaaa.bbbb")).toBeNull();
    expect(decryptToken("not-a-cipher")).toBeNull();
  });
});
