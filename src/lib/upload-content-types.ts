/**
 * The image types we accept on the upload path, and the extension each one
 * gets in its R2 object key.
 *
 * The key's extension is derived from the content type, never from the
 * user-supplied filename — a filename must not reach the object key
 * (`src/app/api/uploads/presign/route.ts`).
 */
export const UPLOAD_EXTENSIONS: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/avif": ".avif",
};

/**
 * Types a phone will happily hand us that we cannot store yet, kept separate
 * from "unknown" so the refusal can say something true.
 *
 * HEIC is the one that matters: it is the iPhone default under
 * Settings → Camera → Formats → "High Efficiency", and whether Safari converts
 * it to JPEG on the way into a file input depends on that setting, which the
 * owner of the phone has never seen. A guest hitting this deserves a sentence
 * telling them which switch to flip, not a generic 400.
 */
export const KNOWN_UNSUPPORTED_TYPES = new Set([
  "image/heic",
  "image/heif",
  "image/heic-sequence",
  "image/heif-sequence",
]);

export type ContentTypeVerdict =
  { ok: true; extension: string } | { ok: false; reason: "heic" | "video" | "unsupported" };

export function classifyContentType(contentType: string): ContentTypeVerdict {
  const normalized = contentType.toLowerCase().split(";")[0]?.trim() ?? "";

  const extension = UPLOAD_EXTENSIONS[normalized];
  if (extension) return { ok: true, extension };

  if (KNOWN_UNSUPPORTED_TYPES.has(normalized)) return { ok: false, reason: "heic" };
  // Video is deferred deliberately (docs/GUEST-GALLERIES.md §14) and guests do
  // not distinguish it from a photo when picking from the camera roll, so it
  // gets its own refusal rather than being lumped in with garbage input.
  if (normalized.startsWith("video/")) return { ok: false, reason: "video" };

  return { ok: false, reason: "unsupported" };
}
