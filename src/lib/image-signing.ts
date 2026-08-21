/**
 * The signed grant that authorises image requests for one gallery view.
 *
 * Mirrors `zip-manifest.ts`'s shape deliberately: same compact
 * `<base64url(json)>.<base64url(hmac)>` token, same Web Crypto (no Node
 * built-ins) so it can run both in the app and — once a signing Worker sits
 * in front of the image path (docs/PLAN.md §4.1 "v2 hardening") — in a
 * Worker too, the same way `verifyManifest` already does for ZIP downloads.
 *
 * One grant covers every photo under a gallery's `storagePrefix`, not one
 * photo or one width — the app already constrains which widths exist
 * (`src/lib/image-sizes.ts`), so a per-request signature would only add
 * minting overhead for every distinct srcset candidate without adding real
 * protection. What the grant actually buys: a captured image URL stops
 * working when its expiry passes, and revoking the share link stops new
 * grants from being minted, even though bytes already fetched under an
 * unexpired grant were never gated by the share link itself (see the
 * verifier the Worker runs — it only knows prefixes and expiry, not
 * galleries or share links).
 */

/** Long enough for one browsing session; short enough that a captured image
 * URL — pasted somewhere, cached, screenshotted mid-URL — goes stale on its
 * own rather than working forever. */
export const IMAGE_GRANT_TTL_SECONDS = 2 * 60 * 60;

export interface ImageAccessGrant {
  /** R2 key prefix this grant covers, e.g. "galleries/<128-bit-random>". */
  prefix: string;
  /** Unix seconds. */
  exp: number;
}

/** What the client actually needs: the signed token and its own expiry, so
 * the UI can tell a stale grant apart from a network error. The prefix isn't
 * included — the client never constructs or checks it, only the Worker does,
 * by decoding the verified token itself. */
export interface SignedImageGrant {
  sig: string;
  exp: number;
}

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function fromBase64url(value: string): Uint8Array<ArrayBuffer> {
  const padded = value
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(value.length + ((4 - (value.length % 4)) % 4), "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function signImageAccess(grant: ImageAccessGrant, secret: string): Promise<string> {
  const payload = base64url(new TextEncoder().encode(JSON.stringify(grant)));
  const signature = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(secret),
    new TextEncoder().encode(payload),
  );
  return `${payload}.${base64url(new Uint8Array(signature))}`;
}

export type VerifyImageAccessResult =
  | { ok: true; grant: ImageAccessGrant }
  | { ok: false; reason: "malformed" | "bad_signature" | "expired" };

export async function verifyImageAccess(
  token: string,
  secret: string,
  now = Date.now(),
): Promise<VerifyImageAccessResult> {
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return { ok: false, reason: "malformed" };

  const payload = token.slice(0, dot);
  const signature = token.slice(dot + 1);

  let valid: boolean;
  try {
    // crypto.subtle.verify is constant-time; never compare signatures with ===.
    valid = await crypto.subtle.verify(
      "HMAC",
      await hmacKey(secret),
      fromBase64url(signature),
      new TextEncoder().encode(payload),
    );
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!valid) return { ok: false, reason: "bad_signature" };

  let grant: ImageAccessGrant;
  try {
    grant = JSON.parse(new TextDecoder().decode(fromBase64url(payload))) as ImageAccessGrant;
  } catch {
    return { ok: false, reason: "malformed" };
  }

  if (typeof grant.prefix !== "string" || !grant.prefix) {
    return { ok: false, reason: "malformed" };
  }
  // Expiry is checked after the signature, so an attacker cannot learn
  // anything from the difference between a forged token and a stale one.
  if (typeof grant.exp !== "number" || grant.exp * 1000 < now) {
    return { ok: false, reason: "expired" };
  }

  return { ok: true, grant };
}

/** Does `key` fall under the grant's prefix? Guards the `/` boundary so
 * "galleries/abc" cannot authorise "galleries/abcdef/…". */
export function keyInGrant(key: string, grant: ImageAccessGrant): boolean {
  return key === grant.prefix || key.startsWith(`${grant.prefix}/`);
}
