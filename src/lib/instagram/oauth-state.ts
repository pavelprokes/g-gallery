// The `state` of the Facebook sign-in (docs/INSTAGRAM-AUDIO.md): a
// random value in a short-lived cookie, compared in constant time when Meta
// sends the person back — a callback someone else started is refused.

import { randomBytes, timingSafeEqual } from "node:crypto";

export const STATE_COOKIE = "ig_oauth_state";
/** Long enough to sign in to Facebook, short enough not to linger. */
export const STATE_MAX_AGE_SECONDS = 600;

export function newState(): string {
  return randomBytes(32).toString("base64url");
}

export function stateMatches(expected: string | undefined, received: string | null): boolean {
  if (!expected || !received) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Where Meta sends the person back — the same address the dialog was given. */
export const CALLBACK_PATH = "/api/instagram/callback";

/** Where to return after the sign-in — the reels page and its chosen galleries. */
export const RETURN_COOKIE = "ig_oauth_return";

/** Only the reels page itself, with at most its `g` list: nothing else can be
 * smuggled into the redirect. */
export function safeReturn(value: string | null | undefined): string {
  return value && /^\/admin\/reels(\?g=[\w,-]{1,1000})?$/.test(value) ? value : "/admin/reels";
}

/** Back on the reels page with what happened, for the admin to say. */
export function reelsWith(origin: string, outcome: string, back?: string): string {
  const url = new URL(safeReturn(back), origin);
  url.searchParams.set("instagram", outcome);
  return url.toString();
}
