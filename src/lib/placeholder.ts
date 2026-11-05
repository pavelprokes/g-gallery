/**
 * The colour a tile shows before its photo arrives.
 *
 * Google Photos fills the grid geometry first and lets the pictures appear
 * into it. We already have that half — width and height are captured at upload,
 * so nothing reflows — but an empty grey rectangle still reads as "broken"
 * while 500 tiles fill in.
 *
 * Since 2026-11-04 a frame of the photo's own shape draws the photo blurred
 * over this colour (src/lib/thumbhash.ts): a ThumbHash is ~28 characters, not
 * the ~400 bytes of a base64 blur that once ruled it out, and a page carries
 * 60 photos, not 500. The colour stays for everything else — and is now the
 * hash's own true average where the upload could compute one.
 */

/** Neutral grey, used when the browser could not read the pixels. */
export const DEFAULT_PLACEHOLDER = "#e5e5e5";

const HEX = /^#[0-9a-f]{6}$/;

/** Rejects anything that is not a 7-character lowercase hex colour. */
export function isPlaceholder(value: string): boolean {
  return HEX.test(value);
}

/** Safe for direct interpolation into a style attribute. */
export function placeholderStyle(value: string | null | undefined): string {
  return value && isPlaceholder(value) ? value : DEFAULT_PLACEHOLDER;
}

/**
 * Averages an image down to one colour by drawing it into a 1×1 canvas and
 * letting the browser do the downsampling — only the fallback now, for an
 * upload that could not compute a ThumbHash: Chromium samples near the middle
 * rather than averaging, so this is the photo's centre more than its mean.
 *
 * Returns null rather than throwing: a missing placeholder is a cosmetic loss,
 * and upload must not fail because a canvas was unavailable or tainted.
 */
export async function averageColorOf(blob: Blob): Promise<string | null> {
  if (typeof createImageBitmap !== "function" || typeof OffscreenCanvas !== "function") {
    return null;
  }

  let bitmap: ImageBitmap | undefined;
  try {
    // Decoding straight to 1×1 keeps a 45 MB drone frame from being fully
    // decoded into memory just to average it.
    bitmap = await createImageBitmap(blob, { resizeWidth: 1, resizeHeight: 1 });
    const canvas = new OffscreenCanvas(1, 1);
    const context = canvas.getContext("2d");
    if (!context) return null;

    context.drawImage(bitmap, 0, 0, 1, 1);
    const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
    if (r === undefined || g === undefined || b === undefined) return null;

    return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
  } catch {
    return null;
  } finally {
    bitmap?.close();
  }
}
