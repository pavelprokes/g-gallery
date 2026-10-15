import { VIDEO_CONTENT_TYPE } from "@/lib/media";

/**
 * The types we accept on the upload path, and the extension each one gets in
 * its R2 object key.
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

/**
 * Who is uploading. Only the photographer may add video (docs/VIDEO.md §1);
 * the two callers share everything else, so this is the one place they differ.
 */
export type UploadCaller = "owner" | "guest";

export type ContentTypeVerdict =
  | { ok: true; extension: string; kind: "PHOTO" | "VIDEO" }
  | { ok: false; reason: "heic" | "video" | "video_format" | "unsupported" };

export function classifyContentType(contentType: string, caller: UploadCaller): ContentTypeVerdict {
  const normalized = contentType.toLowerCase().split(";")[0]?.trim() ?? "";

  const extension = UPLOAD_EXTENSIONS[normalized];
  if (extension) return { ok: true, extension, kind: "PHOTO" };

  if (KNOWN_UNSUPPORTED_TYPES.has(normalized)) return { ok: false, reason: "heic" };

  if (normalized.startsWith("video/")) {
    // Guests do not distinguish a video from a photo when picking from the
    // camera roll, so theirs gets its own refusal rather than being lumped in
    // with garbage input (docs/GUEST-GALLERIES.md §14).
    if (caller === "guest") return { ok: false, reason: "video" };
    // The photographer's MP4 is the one container every browser plays; a
    // .mov, .mkv or .avi gets a sentence saying to export H.264 MP4 instead.
    if (normalized === VIDEO_CONTENT_TYPE) return { ok: true, extension: ".mp4", kind: "VIDEO" };
    return { ok: false, reason: "video_format" };
  }

  return { ok: false, reason: "unsupported" };
}
