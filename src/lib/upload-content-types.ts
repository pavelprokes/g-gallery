/**
 * The image types we accept on the upload path, and the extension each one
 * gets in its R2 object key.
 *
 * The key's extension is derived from the content type, never from the
 * user-supplied filename — a filename must not reach the object key
 * (`src/app/api/uploads/presign/route.ts`).
 */
/** The one video type the photographer may upload (docs/VIDEO.md). */
export const VIDEO_CONTENT_TYPE = "video/mp4";

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
  | { ok: true; extension: string; video?: true }
  | { ok: false; reason: "heic" | "video" | "unsupported" };

export interface ClassifyOptions {
  /**
   * The photographer's own upload, which may carry an MP4 (docs/VIDEO.md).
   * Guests never get this: guest video stays out of scope
   * (docs/GUEST-GALLERIES.md §14).
   */
  allowVideo?: boolean;
}

export function classifyContentType(
  contentType: string,
  { allowVideo = false }: ClassifyOptions = {},
): ContentTypeVerdict {
  const normalized = contentType.toLowerCase().split(";")[0]?.trim() ?? "";

  const extension = UPLOAD_EXTENSIONS[normalized];
  if (extension) return { ok: true, extension };

  if (KNOWN_UNSUPPORTED_TYPES.has(normalized)) return { ok: false, reason: "heic" };
  // One container only: H.264 in MP4 is the one combination every browser
  // plays, and the photographer exports it on purpose. A `.mov` straight off
  // an iPhone is usually HEVC, which desktop Chrome and Firefox often cannot
  // play — so it is refused by name rather than stored as a black box.
  if (allowVideo && normalized === VIDEO_CONTENT_TYPE) {
    return { ok: true, extension: ".mp4", video: true };
  }
  // Guests do not distinguish a video from a photo when picking from the
  // camera roll, so it gets its own refusal rather than being lumped in with
  // garbage input.
  if (normalized.startsWith("video/")) return { ok: false, reason: "video" };

  return { ok: false, reason: "unsupported" };
}
