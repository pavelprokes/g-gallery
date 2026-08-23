import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Reversible storage for share and event tokens, so the admin can show and
 * copy a link at any time rather than exactly once at creation
 * (Pavel, 2026-08-23).
 *
 * This is a deliberate, documented relaxation of what CLAUDE.md invariant 5
 * used to say. Be precise about what changed and what did not:
 *
 * - `tokenHash` (SHA-256) is still the **only** thing access is resolved by.
 *   Nothing looks a token up by its ciphertext, and a row without a ciphertext
 *   keeps working exactly as before.
 * - The ciphertext is for **display only**, and the key lives in the
 *   environment, never in the database. A leaked database dump — which is the
 *   realistic exposure, since backups go to R2 — does not yield tokens on its
 *   own. Someone holding both the dump and the app's environment does.
 * - Passwords are untouched: they are scrypt-hashed and stay one-way.
 *
 * AES-256-GCM, so a tampered ciphertext fails to decrypt rather than
 * decrypting to garbage. Format: `v1.<base64url iv>.<base64url ciphertext+tag>`.
 */
const VERSION = "v1";
const IV_BYTES = 12; // 96-bit nonce, the size GCM is specified for
const KEY_BYTES = 32;

function key(): Buffer | null {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) return null;

  const parsed = Buffer.from(raw, "base64");
  if (parsed.length !== KEY_BYTES) {
    // Loud, because a short key silently weakens every token we store.
    throw new Error(
      `TOKEN_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes (got ${parsed.length}) — generate one with: openssl rand -base64 32`,
    );
  }
  return parsed;
}

/** Whether links can be shown again at all in this deployment. */
export function tokenCipherConfigured(): boolean {
  return key() !== null;
}

/**
 * Null when no key is configured — the caller stores null and the admin says
 * the address cannot be shown, which is the pre-2026-08-23 behaviour. Rolling
 * this out without the env var must degrade, not crash.
 */
export function encryptToken(token: string): string | null {
  const secret = key();
  if (!secret) return null;

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", secret, iv);
  const body = Buffer.concat([cipher.update(token, "utf8"), cipher.final(), cipher.getAuthTag()]);

  return `${VERSION}.${iv.toString("base64url")}.${body.toString("base64url")}`;
}

/**
 * Null for anything that cannot be read back: no key, a row from before this
 * existed, a rotated key, or a tampered value. Every one of those means the
 * same thing to the caller — "this link cannot be displayed" — and none of
 * them should throw into a page render.
 */
export function decryptToken(stored: string | null | undefined): string | null {
  const secret = key();
  if (!secret || !stored) return null;

  const [version, ivPart, bodyPart] = stored.split(".");
  if (version !== VERSION || !ivPart || !bodyPart) return null;

  try {
    const iv = Buffer.from(ivPart, "base64url");
    const body = Buffer.from(bodyPart, "base64url");
    if (iv.length !== IV_BYTES || body.length <= 16) return null;

    const tag = body.subarray(body.length - 16);
    const payload = body.subarray(0, body.length - 16);

    const decipher = createDecipheriv("aes-256-gcm", secret, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(payload), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
