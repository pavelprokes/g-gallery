import { rgbaToThumbHash, thumbHashToAverageRGBA, thumbHashToDataURL } from "thumbhash";
import type { CSSProperties } from "react";
import { isPlaceholder } from "@/lib/placeholder";
import { thumbSize } from "@/lib/thumbnail";

/**
 * A blurred version of the photo, drawn before any of its bytes arrive
 * (docs/GALLERY-LOADING.md).
 *
 * ThumbHash (Evan Wallace, MIT, no dependencies) packs the photo's low
 * frequencies into ~21 bytes — 28 characters of base64 in the page's data —
 * from which the browser renders a ~32 px image in well under a millisecond.
 * That replaces the reasoning `placeholder.ts` once gave against a blur: it
 * was ~400 bytes a photo then, and a page carried 500 photos; now it is 14×
 * smaller and a page carries 60.
 *
 * Stored as standard base64 in `Photo.thumbhash`. Everything here returns
 * null rather than throwing: a missing blur leaves the average colour, which
 * is what every tile showed before.
 */

/** ThumbHash's own maximum input size, in pixels on the long side. */
export const THUMBHASH_MAX_SIDE = 100;

/**
 * A ThumbHash is 5 bytes of header (6 with alpha) plus 8–19 of coefficients,
 * whatever the photo: base64 of that is 20–36 characters. This is the only
 * check on a value anonymous guests can write through confirm.
 */
const BASE64 = /^(?=.{20,36}$)[A-Za-z0-9+/]+={0,2}$/;

export function isThumbhash(value: string): boolean {
  return bytesOf(value) !== null;
}

function bytesOf(value: string): Uint8Array | null {
  if (!BASE64.test(value) || value.length % 4 !== 0) return null;
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  // The fourth byte's low three bits: coefficients on the photo's short side.
  // The encoder writes at least one; the decoder takes the shape from them, so
  // a zero would draw a 0 px image — an invalid PNG in the page.
  return bytes[3]! & 7 ? bytes : null;
}

function base64Of(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * Decoded data URLs, by hash. A tile re-renders often (selection, the screen
 * gate, hover) and a decode is ~0.2 ms; a gallery's grid mounts a few dozen
 * tiles at a time, so a small cap keeps the strings (~4 kB each, an
 * uncompressed PNG) from piling up over a 2 000-photo scroll.
 */
const CACHE_LIMIT = 240;
const dataUrls = new Map<string, string | null>();

/** A PNG data URL of the blurred photo, or null when there is none to draw. */
export function thumbhashDataUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  const cached = dataUrls.get(value);
  if (cached !== undefined) return cached;
  const bytes = bytesOf(value);
  let url: string | null = null;
  if (bytes) {
    try {
      url = thumbHashToDataURL(bytes);
    } catch {
      url = null;
    }
  }
  if (dataUrls.size >= CACHE_LIMIT) {
    // Oldest first: a Map iterates in insertion order.
    const oldest = dataUrls.keys().next().value;
    if (oldest !== undefined) dataUrls.delete(oldest);
  }
  dataUrls.set(value, url);
  return url;
}

/**
 * The style that fills a frame before its photo arrives: the blur over the
 * average colour.
 *
 * Only for a frame that is already the photo's own shape (a grid tile, a
 * highlight, the linked photo's frame): the blur is stretched to it. The
 * hash stores the shape only approximately, so drawn at its own inside a box
 * that letterboxes it would leave edges around the photo once it arrives.
 *
 * `backgroundColor` must already be a safe colour (`placeholderStyle`); the
 * data URL is ours, built from validated bytes, and contains no quotes.
 */
export function blurStyle(
  thumbhash: string | null | undefined,
  backgroundColor: string,
): CSSProperties {
  return blurStyleOf(thumbhashDataUrl(thumbhash), backgroundColor);
}

/** The same from a data URL the server already drew. */
export function blurStyleOf(dataUrl: string | null, backgroundColor: string): CSSProperties {
  if (!dataUrl) return { backgroundColor };
  return { backgroundColor, backgroundImage: `url("${dataUrl}")`, backgroundSize: "100% 100%" };
}

/** The ThumbHash's average colour as "#rrggbb" — a true average. */
export function thumbhashAverage(value: string): string | null {
  const bytes = bytesOf(value);
  if (!bytes) return null;
  try {
    const { r, g, b } = thumbHashToAverageRGBA(bytes);
    const hex = `#${[r, g, b]
      .map((c) =>
        Math.round(Math.min(1, Math.max(0, c)) * 255)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")}`;
    return isPlaceholder(hex) ? hex : null;
  } catch {
    return null;
  }
}

/** Pure, for tests: RGBA pixels (≤100 px a side) to the stored string. */
export function thumbhashOfPixels(width: number, height: number, rgba: ArrayLike<number>): string {
  return base64Of(rgbaToThumbHash(width, height, rgba));
}

/**
 * A photo's ThumbHash and its true average colour, from an image already
 * decoded for something else (the upload reads its dimensions from the same
 * bitmap).
 *
 * The image is halved step by step until it fits, with plain bilinear sampling
 * ("low"): at a scale of exactly ½ that is an exact 2×2 average, so every pixel
 * counts towards the result — an odd last row or column is left out, or the
 * scale would not be ½. The old 1×1 resize did not: Chromium sampled near the
 * centre, so a castle came out green from the ivy by its door. ("high" is each
 * engine's own idea of high.)
 *
 * Each canvas is released as soon as the next one is drawn: this runs for every
 * file of a batch on a phone, and a canvas left to the garbage collector holds
 * ~12 MB for a 12 MP photo until it runs. Measured over 80 such photos: in
 * Chromium ~30 MB on top of the decoding's own peak, where unreleased canvases
 * added ~150 MB; on a Mac's WebKit the decoding's peak covers either. One canvas
 * drawn over itself was slower and no smaller.
 *
 * DOM-free — OffscreenCanvas only — so it runs in the upload worker.
 */
export function thumbhashOfImage(
  image: CanvasImageSource,
  width: number,
  height: number,
): { thumbhash: string; average: string | null } | null {
  if (typeof OffscreenCanvas !== "function" || width < 1 || height < 1) return null;
  const size = thumbSize(width, height, THUMBHASH_MAX_SIDE);
  let held: OffscreenCanvas | null = null;
  try {
    let w = width;
    let h = height;
    for (;;) {
      const halving = w >= size.width * 2 && h >= size.height * 2;
      const nextW = halving ? w >> 1 : size.width;
      const nextH = halving ? h >> 1 : size.height;
      const next: OffscreenCanvas = new OffscreenCanvas(nextW, nextH);
      const context = next.getContext("2d");
      if (!context) return null;
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "low";
      const fromW = halving ? nextW * 2 : w;
      const fromH = halving ? nextH * 2 : h;
      context.drawImage(held ?? image, 0, 0, fromW, fromH, 0, 0, nextW, nextH);
      release(held);
      held = next;
      if (!halving) {
        const { data } = context.getImageData(0, 0, nextW, nextH);
        const thumbhash = thumbhashOfPixels(nextW, nextH, data);
        return { thumbhash, average: thumbhashAverage(thumbhash) };
      }
      w = nextW;
      h = nextH;
    }
  } catch {
    return null;
  } finally {
    release(held);
  }
}

function release(canvas: OffscreenCanvas | null): void {
  if (!canvas) return;
  canvas.width = 0;
  canvas.height = 0;
}

/** The same, from a file: decodes it first. Null when it cannot be read. */
export async function thumbhashOfBlob(
  blob: Blob,
): Promise<{ thumbhash: string; average: string | null } | null> {
  if (typeof createImageBitmap !== "function") return null;
  let bitmap: ImageBitmap | undefined;
  try {
    bitmap = await createImageBitmap(blob);
    return thumbhashOfImage(bitmap, bitmap.width, bitmap.height);
  } catch {
    return null;
  } finally {
    bitmap?.close();
  }
}

/**
 * Several pages of photos at once — a photo's link (the page carries every
 * page up to it) or a jump to a chapter or highlight (one request up to its
 * target) — keep the blur only where the viewer lands: the last page, and the
 * one before it, because the target can be the last page's first tile and the
 * rows above it on screen come from the page before. The grid passes the rest
 * in one instant scroll, and a blur on all of them would be up to ~20 kB on
 * 600 photos, read before the one photo being waited for. Scrolled back to,
 * those pages show the colour until a refetch: nothing pulls them again.
 */
export function blurOnLastTwoPages<T extends { thumbhash: string | null }>(
  pages: { items: T[]; nextCursor: string | null }[],
): { items: T[]; nextCursor: string | null }[] {
  if (pages.length < 3) return pages;
  return pages.map((page, i) =>
    i >= pages.length - 2
      ? page
      : { ...page, items: page.items.map((item) => ({ ...item, thumbhash: null })) },
  );
}
