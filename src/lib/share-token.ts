import "server-only";
import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);

const TOKEN_BYTES = 16; // 128 bits
const SCRYPT_KEYLEN = 64;

/** Raw share token — returned once, shown to the owner, never stored. */
export function generateShareToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

/** Only the hash is persisted (ShareLink.tokenHash). */
export function hashShareToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Same primitive better-auth uses for passwords, so no native dependency is
 * needed. Format: "<salt-hex>:<derived-key-hex>".
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = (await scryptAsync(password, salt, SCRYPT_KEYLEN)) as Buffer;
  return `${salt.toString("hex")}:${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, keyHex] = stored.split(":");
  if (!saltHex || !keyHex) return false;

  const expected = Buffer.from(keyHex, "hex");
  const derived = (await scryptAsync(
    password,
    Buffer.from(saltHex, "hex"),
    expected.length,
  )) as Buffer;
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

/** Unguessable R2 key prefix for a gallery: "galleries/<128-bit-random>". */
export function generateStoragePrefix(): string {
  return `galleries/${randomBytes(TOKEN_BYTES).toString("hex")}`;
}
