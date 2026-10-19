import { createHmac, randomInt, timingSafeEqual } from "node:crypto";

// The corrections mode (docs/CORRECTIONS.md). The couple enters a link's
// 6-digit PIN each time they open the mode; the server answers with a session
// key the page keeps in memory only — never a cookie — so a reload, a closed
// tab or "Ukončit" asks for the PIN again, as Pavel wants. The key is signed
// with the PIN's hash: a new PIN ends every open session.

/** How long one entry into the mode lasts without re-entering the PIN. */
export const CORRECTION_SESSION_MS = 2 * 60 * 60 * 1000;

/** A fresh 6-digit PIN, leading zeros kept. */
export function generateCorrectionPin(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/** Shape check before any scrypt work: exactly six digits. */
export function isPinShaped(value: string): boolean {
  return /^\d{6}$/.test(value);
}

function signature(secret: string, shareLinkId: string, pinHash: string, expires: number) {
  return createHmac("sha256", secret)
    .update(`corrections:${shareLinkId}:${pinHash}:${expires}`)
    .digest("base64url");
}

/** `<expires>.<signature>` for one link and the PIN it was opened with. */
export function signCorrectionSession(
  secret: string,
  shareLinkId: string,
  pinHash: string,
  now: number = Date.now(),
): { session: string; expiresAt: number } {
  const expires = now + CORRECTION_SESSION_MS;
  return {
    session: `${expires}.${signature(secret, shareLinkId, pinHash, expires)}`,
    expiresAt: expires,
  };
}

/** Whether a presented session key is this link's, under its current PIN, and unexpired. */
export function verifyCorrectionSession(
  secret: string,
  session: string | null | undefined,
  shareLinkId: string,
  pinHash: string | null,
  now: number = Date.now(),
): boolean {
  if (!session || !pinHash) return false;
  const [expiresText, presented] = session.split(".");
  const expires = Number(expiresText);
  if (!presented || !Number.isSafeInteger(expires) || expires <= now) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(signature(secret, shareLinkId, pinHash, expires));
  return a.length === b.length && timingSafeEqual(a, b);
}
