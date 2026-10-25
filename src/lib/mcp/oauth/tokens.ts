import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export type TokenKind = "code" | "access" | "refresh";

/** Recognisable in a log or a secret scanner, never parsed. */
const TOKEN_PREFIX: Record<TokenKind, string> = { code: "ggc", access: "gga", refresh: "ggr" };
const CODE_VERIFIER_PATTERN = /^[A-Za-z0-9\-._~]{43,128}$/;
const CODE_CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function newToken(kind: TokenKind): string {
  return `${TOKEN_PREFIX[kind]}_${randomBytes(32).toString("base64url")}`;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function isCodeChallenge(value: string): boolean {
  return CODE_CHALLENGE_PATTERN.test(value);
}

/** PKCE S256 (RFC 7636 §4.6), compared in constant time. */
export function verifyPkce(verifier: string, challenge: string): boolean {
  if (!CODE_VERIFIER_PATTERN.test(verifier) || !isCodeChallenge(challenge)) return false;
  const computed = Buffer.from(createHash("sha256").update(verifier).digest("base64url"));
  const expected = Buffer.from(challenge);
  return computed.length === expected.length && timingSafeEqual(computed, expected);
}
