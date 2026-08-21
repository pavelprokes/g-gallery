/**
 * The colour a tile shows before its photo arrives.
 *
 * Google Photos fills the grid geometry first and lets the pictures appear
 * into it. We already have that half — width and height are captured at upload,
 * so nothing reflows — but an empty grey rectangle still reads as "broken"
 * while 500 tiles fill in.
 *
 * A solid average colour rather than a blurred thumbnail: at grid size the
 * visual difference is slight, but a base64 blur placeholder is ~400 bytes per
 * photo embedded in the HTML, which is 200 kB added to a 500-photo page. Seven
 * bytes of hex is 1/50th of that for most of the benefit.
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
 * letting the browser do the downsampling.
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
