/**
 * The grid thumbnail the phone makes for itself (docs/GUEST-GALLERIES.md §9).
 *
 * Why the browser and not the CDN: every distinct (photo × width × quality) is
 * a billable Cloudflare transformation, 5 000/month free, and one wedding with
 * 800 guest photos spends half of that on thumbnails nobody looked at twice.
 * The phone is already holding the decoded image, so it can produce the small
 * version for nothing — and on a venue with one bar of signal a 40 kB tile
 * beats a 400 kB one by more than the transformation saving.
 *
 * **The fallback is the important part.** Anything that fails here returns
 * null, the photo uploads exactly as before, and the grid falls back to a
 * Cloudflare transformation of the original. No device is ever worse off than
 * it is today; some are better.
 */

/** Long edge in pixels. Covers a two-column grid at 2× without visible softness. */
export const THUMB_MAX_PX = 512;

/** WebP quality. Low enough to matter on a bad connection, high enough not to band. */
const THUMB_QUALITY = 0.72;

/**
 * WebP only, deliberately. Producing JPEG instead when a browser cannot encode
 * WebP would mean two possible extensions for one presigned key, and a signed
 * PUT is bound to one content type. Every browser this ships to encodes WebP
 * (Safari since 14); anything older simply gets the fallback, which is the
 * behaviour it has today.
 */
const THUMB_TYPE = "image/webp";

/**
 * Derived from the original's key, not supplied by the client — a client-named
 * key is a client-chosen write location inside the gallery's prefix.
 */
export function thumbKeyFor(objectKey: string): string {
  const dot = objectKey.lastIndexOf(".");
  const stem = dot > objectKey.lastIndexOf("/") ? objectKey.slice(0, dot) : objectKey;
  return `${stem}.thumb.webp`;
}

/** True for keys `thumbKeyFor` produced — the loader serves these untransformed. */
export function isThumbKey(key: string): boolean {
  return key.endsWith(".thumb.webp");
}

/** The content type a thumbnail PUT is signed for. */
export const THUMB_CONTENT_TYPE = THUMB_TYPE;

/** Bounded so the long edge is THUMB_MAX_PX and the aspect ratio is kept. */
export function thumbSize(
  width: number,
  height: number,
  max = THUMB_MAX_PX,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  // Never upscale: a 300 px original would otherwise become a bigger file than
  // the thing it is standing in for.
  if (longest <= max) return { width, height };

  const scale = max / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Browser-only. Null whenever anything is missing or fails — that is the
 * fallback path, not an error worth surfacing.
 */
export async function makeThumbnail(source: Blob): Promise<Blob | null> {
  if (typeof createImageBitmap !== "function" || typeof OffscreenCanvas !== "function") {
    return null;
  }

  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(source);
    const size = thumbSize(bitmap.width, bitmap.height);

    const canvas = new OffscreenCanvas(size.width, size.height);
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(bitmap, 0, 0, size.width, size.height);

    const blob = await canvas.convertToBlob({ type: THUMB_TYPE, quality: THUMB_QUALITY });
    // A browser that cannot encode WebP silently hands back a PNG, which would
    // be larger than the original and stored under the wrong content type.
    if (blob.type !== THUMB_TYPE) return null;
    // If the "thumbnail" is not smaller, it has no reason to exist.
    if (blob.size >= source.size) return null;

    return blob;
  } catch {
    return null;
  } finally {
    bitmap?.close();
  }
}
