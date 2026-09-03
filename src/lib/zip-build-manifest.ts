/**
 * The signed handoff from the app to the background ZIP-builder Worker
 * (docs/TODO.md §7) — same HMAC scheme as `zip-manifest.ts`'s live-download
 * manifest, but a distinct type and secret: this one kicks off a multi-part
 * background build, not a single streamed response, and the two Workers are
 * deployed and billed separately on purpose (the live one needs Workers
 * Paid; this one is designed to stay on the free tier).
 *
 * Runs in Node (the app's cron route) and in Workers (the builder), so it
 * uses Web Crypto and no Node built-ins — identical constraint to
 * `zip-manifest.ts`.
 */

export const BUILD_MANIFEST_TTL_SECONDS = 300;

export interface BuildManifestEntry {
  /** R2 object key to read this photo's bytes from. */
  key: string;
  /** Name inside the finished archive. */
  name: string;
  size: number;
  /** Hex CRC32, captured at upload — never computed by the builder. */
  crc32: string;
}

export interface BuildManifest {
  galleryId: string;
  /**
   * Identifies this build, and nothing else. Random per build rather than
   * derived from the gallery, because *two* builds of one gallery can overlap
   * — an admin edit supersedes a running build and the next tick starts
   * another. Deriving the name from `galleryId` made both builds share their
   * tracking manifest and part markers in R2, so finalize could complete one
   * multipart upload with etags belonging to the other.
   *
   * 128 bits of randomness also keeps the bookkeeping unguessable in a bucket
   * that is served publicly, which is what the previous HMAC-of-galleryId was
   * for; randomness covers both jobs at once.
   */
  buildId: string;
  /** R2 key the finished archive is written to. */
  objectKey: string;
  /** Filename offered to the browser — becomes the object's Content-Disposition, so the CDN link downloads correctly with no Worker involved. */
  archiveName: string;
  entries: BuildManifestEntry[];
  /** Unix seconds. */
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

export async function signBuildManifest(manifest: BuildManifest, secret: string): Promise<string> {
  const payload = base64url(new TextEncoder().encode(JSON.stringify(manifest)));
  const signature = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(secret),
    new TextEncoder().encode(payload),
  );
  return `${payload}.${base64url(new Uint8Array(signature))}`;
}

export type VerifyBuildManifestResult =
  | { ok: true; manifest: BuildManifest }
  | { ok: false; reason: "malformed" | "bad_signature" | "expired" };

export async function verifyBuildManifest(
  token: string,
  secret: string,
  now = Date.now(),
): Promise<VerifyBuildManifestResult> {
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return { ok: false, reason: "malformed" };

  const payload = token.slice(0, dot);
  const signature = token.slice(dot + 1);

  let valid: boolean;
  try {
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

  let manifest: BuildManifest;
  try {
    manifest = JSON.parse(new TextDecoder().decode(fromBase64url(payload))) as BuildManifest;
  } catch {
    return { ok: false, reason: "malformed" };
  }

  if (!Array.isArray(manifest.entries) || manifest.entries.length === 0) {
    return { ok: false, reason: "malformed" };
  }
  // Every R2 key the builder writes is derived from this, so a missing or
  // oddly-shaped one must never reach the Worker's key construction.
  if (typeof manifest.buildId !== "string" || !/^[0-9a-f]{32}$/.test(manifest.buildId)) {
    return { ok: false, reason: "malformed" };
  }
  if (typeof manifest.exp !== "number" || manifest.exp * 1000 < now) {
    return { ok: false, reason: "expired" };
  }

  return { ok: true, manifest };
}
