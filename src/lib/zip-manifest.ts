/**
 * The signed manifest that authorises one ZIP download.
 *
 * The ZIP is built by a Cloudflare Worker, which sits entirely outside the app
 * session (docs/PLAN.md §7). Rather than have the Worker call back to Vercel,
 * the app hands the browser a manifest signed with a secret both sides share;
 * the browser POSTs it to the Worker, which verifies and streams.
 *
 * Nothing secret is in the manifest — the object keys are already the `src` of
 * every photo on the page. The signature is what stops a viewer from editing
 * the key list to reach a gallery they were never given a link to.
 *
 * Runs in Node (the app) and in Workers (the ZIP writer), so it uses Web Crypto
 * and no Node built-ins.
 */

/** Short: it only has to survive the round trip from mint to Worker fetch. */
export const MANIFEST_TTL_SECONDS = 300;

export interface ManifestEntry {
  /** R2 object key. */
  key: string;
  /** Name inside the archive. */
  name: string;
  size: number;
  /** Hex CRC32 computed in the browser at upload; null makes the Worker compute it. */
  crc32: string | null;
}

export interface Manifest {
  galleryId: string;
  /** Archive filename offered to the browser. */
  archiveName: string;
  entries: ManifestEntry[];
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

/** `<base64url(json)>.<base64url(hmac)>` — compact and safe in a form field. */
export async function signManifest(manifest: Manifest, secret: string): Promise<string> {
  const payload = base64url(new TextEncoder().encode(JSON.stringify(manifest)));
  const signature = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(secret),
    new TextEncoder().encode(payload),
  );
  return `${payload}.${base64url(new Uint8Array(signature))}`;
}

export type VerifyResult =
  | { ok: true; manifest: Manifest }
  | { ok: false; reason: "malformed" | "bad_signature" | "expired" };

export async function verifyManifest(
  token: string,
  secret: string,
  now = Date.now(),
): Promise<VerifyResult> {
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

  let manifest: Manifest;
  try {
    manifest = JSON.parse(new TextDecoder().decode(fromBase64url(payload))) as Manifest;
  } catch {
    return { ok: false, reason: "malformed" };
  }

  if (!Array.isArray(manifest.entries) || manifest.entries.length === 0) {
    return { ok: false, reason: "malformed" };
  }
  // Expiry is checked AFTER the signature, so an attacker cannot learn anything
  // from the difference between a forged token and a stale one.
  if (typeof manifest.exp !== "number" || manifest.exp * 1000 < now) {
    return { ok: false, reason: "expired" };
  }

  return { ok: true, manifest };
}

/**
 * Archive entry names.
 *
 * Two photos can share a filename (two cameras, same counter), and a ZIP with
 * duplicate names extracts unpredictably — some tools overwrite silently. The
 * suffix is added to the stem, never after the extension.
 */
export function uniqueNames(fileNames: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return fileNames.map((raw) => {
    const name = sanitizeEntryName(raw);
    const lower = name.toLowerCase();
    const count = seen.get(lower) ?? 0;
    seen.set(lower, count + 1);
    if (count === 0) return name;

    const dot = name.lastIndexOf(".");
    return dot > 0 ? `${name.slice(0, dot)} (${count})${name.slice(dot)}` : `${name} (${count})`;
  });
}

/**
 * Strips anything that could escape the extraction directory or break an
 * extractor: path separators, drive-relative prefixes, control characters.
 */
export function sanitizeEntryName(name: string): string {
  const flat = name
    .replaceAll("\\", "/")
    .split("/")
    .pop()!
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim();

  // "..", "." and the empty string are all unusable as entry names.
  if (flat === "" || flat === "." || flat === "..") return "photo.jpg";
  return flat.slice(0, 200);
}
