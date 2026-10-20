// What the public slideshow maker accepts (docs/SLIDESHOW-MAKER.md §3). Every
// check runs in the visitor's browser — the photos never leave it — so these
// bounds protect the visitor's device, not a server: decoding is the costly
// step, and a phone runs out of memory long before a desktop does.

export const MIN_PHOTOS = 3;
export const MAX_PHOTOS = 60;

export const MIN_BYTES = 20 * 1024;
export const MAX_BYTES = 40 * 1024 * 1024;

/** The shorter side, in pixels: below it a 1080 px wide frame is a visible upscale. */
export const MIN_SHORT_EDGE = 1000;
/** A 61 MP body's full frame passes; anything larger costs a phone ~250 MB to decode. */
export const MAX_PIXELS = 62_000_000;
export const MAX_LONG_EDGE = 12_000;

/** The formats every browser that can make the video also decodes. */
export const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export type FileProblem = "type" | "tooSmallFile" | "tooLargeFile";
export type SizeProblem = "tooFewPixels" | "tooManyPixels";

export function fileProblem(file: { type: string; size: number }): FileProblem | null {
  if (!(ACCEPTED_TYPES as readonly string[]).includes(file.type)) return "type";
  if (file.size < MIN_BYTES) return "tooSmallFile";
  if (file.size > MAX_BYTES) return "tooLargeFile";
  return null;
}

export function sizeProblem(width: number, height: number): SizeProblem | null {
  if (Math.min(width, height) < MIN_SHORT_EDGE) return "tooFewPixels";
  if (width * height > MAX_PIXELS || Math.max(width, height) > MAX_LONG_EDGE) {
    return "tooManyPixels";
  }
  return null;
}

/** How many of `offered` new photos still fit next to `held` ones. */
export function room(held: number, offered: number): number {
  return Math.max(0, Math.min(offered, MAX_PHOTOS - held));
}
