import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

// A password-protected share link is unlocked once and remembered in a signed,
// httpOnly cookie. The signature is derived from the stored password hash, so
// changing (or clearing) the gallery password invalidates every outstanding
// unlock cookie automatically.

const COOKIE_PREFIX = "gg_unlock_";
const MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

function secret(): string {
  const value = process.env.BETTER_AUTH_SECRET;
  if (!value) throw new Error("BETTER_AUTH_SECRET is required to sign unlock cookies");
  return value;
}

function sign(shareLinkId: string, passwordHash: string): string {
  return createHmac("sha256", secret()).update(`${shareLinkId}:${passwordHash}`).digest("hex");
}

function cookieName(shareLinkId: string): string {
  return `${COOKIE_PREFIX}${shareLinkId}`;
}

export async function isUnlocked(shareLinkId: string, passwordHash: string): Promise<boolean> {
  const store = await cookies();
  const presented = store.get(cookieName(shareLinkId))?.value;
  if (!presented) return false;

  const expected = sign(shareLinkId, passwordHash);
  const a = Buffer.from(presented, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function setUnlockCookie(shareLinkId: string, passwordHash: string): Promise<void> {
  const store = await cookies();
  store.set(cookieName(shareLinkId), sign(shareLinkId, passwordHash), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}
