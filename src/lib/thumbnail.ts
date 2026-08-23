/**
 * The grid thumbnail the phone makes for itself (docs/GUEST-GALLERIES.md §9).
 *
 * Why the browser and not the CDN: every distinct (photo × width × quality) is
 * a billable Cloudflare transformation, 5 000/month free, and one wedding with
 * 800 guest photos spends half of that on thumbnails nobody looked at twice.
 * The phone is already holding the decoded image, so it can produce the small
 * version for nothing — and on a venue with one bar of signal a 20 kB tile
 * beats a 400 kB one by more than the transformation saving.
 *
 * **The fallback is the important part.** Every step degrades instead of
 * failing: no pica → plain canvas; no WebP → JPEG; nothing at all → null, the
 * photo uploads exactly as before and the grid falls back to a Cloudflare
 * transformation of the original. No device ends up worse off than it is today.
 */

/** Long edge in pixels. Covers a two-column grid at 2× without visible softness. */
export const THUMB_MAX_PX = 512;

const WEBP_QUALITY = 0.72;
/** JPEG needs a touch more to avoid ringing on the same content. */
const JPEG_QUALITY = 0.78;

export type ThumbFormat = "webp" | "jpeg";

export const THUMB_CONTENT_TYPES: Record<ThumbFormat, string> = {
  webp: "image/webp",
  jpeg: "image/jpeg",
};

const THUMB_EXTENSIONS: Record<ThumbFormat, string> = {
  webp: ".thumb.webp",
  jpeg: ".thumb.jpg",
};

/**
 * Derived from the original's key, never supplied by the client — a
 * client-named key is a client-chosen write location inside the gallery's
 * prefix.
 */
export function thumbKeyFor(objectKey: string, format: ThumbFormat): string {
  const dot = objectKey.lastIndexOf(".");
  const stem = dot > objectKey.lastIndexOf("/") ? objectKey.slice(0, dot) : objectKey;
  return `${stem}${THUMB_EXTENSIONS[format]}`;
}

/** True for keys `thumbKeyFor` produced — the loader serves these untransformed. */
export function isThumbKey(key: string): boolean {
  return Object.values(THUMB_EXTENSIONS).some((extension) => key.endsWith(extension));
}

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
 * Time limits, because the failure that actually hurts is not an exception —
 * it is a worker that never answers. Without these the `await` would hang and
 * the guest's upload would sit at "Nahrávám" until they gave up.
 *
 * Generous on purpose: a slow phone resizing a 48 Mpx photo is normal, a
 * ten-second one is not.
 */
const PICA_LOAD_TIMEOUT_MS = 8_000;
const PICA_RESIZE_TIMEOUT_MS = 10_000;
/** Ceiling for the whole thing, encode included. Past this: no thumbnail. */
const THUMBNAIL_TIMEOUT_MS = 25_000;

const LOG_PREFIX = "[g-gallery/thumbnail]";

/**
 * Rejects if the work has not finished in time. The original promise is left
 * to settle on its own — there is nothing to cancel and nothing reads it after.
 */
export async function withTimeout<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * One pica instance per page, not per photo: it owns a pool of web workers, and
 * a forty-photo batch would otherwise spin up and tear down forty of them.
 * Loaded on demand — 14 kB nobody who only browses the gallery should pay for.
 */
let picaPromise: Promise<{ resize: PicaResize } | null> | null = null;

/**
 * Set once pica has failed or timed out, and never unset. In a batch of forty
 * photos, retrying a resizer that just stalled for ten seconds would cost the
 * guest six minutes to arrive at the same answer forty times.
 */
let picaDisabled = false;

type PicaResize = (
  from: ImageBitmap,
  to: HTMLCanvasElement,
  options?: { filter?: string },
) => Promise<HTMLCanvasElement>;

async function loadPica(): Promise<{ resize: PicaResize } | null> {
  if (picaDisabled) return null;

  picaPromise ??= import("pica")
    .then((module) => {
      const instance = module.default();
      return { resize: instance.resize.bind(instance) as PicaResize };
    })
    .catch(() => null);

  try {
    const loaded = await withTimeout(picaPromise, PICA_LOAD_TIMEOUT_MS, "pica load");
    if (!loaded) disablePica("pica failed to load");
    return loaded;
  } catch (error) {
    disablePica(error);
    return null;
  }
}

function disablePica(reason: unknown): void {
  if (picaDisabled) return;
  picaDisabled = true;
  // Deliberately visible: this is not an error for the guest — the thumbnail
  // still gets made, just with plain canvas scaling — but it is the thing
  // anyone debugging a "why do the tiles look crunchy" report needs to see.
  console.warn(
    `${LOG_PREFIX} pica unavailable, falling back to canvas scaling for the rest of this session:`,
    reason,
  );
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * Browser-only. Null whenever anything is missing or fails — that is the
 * fallback path, not an error worth surfacing.
 */
export async function makeThumbnail(
  source: Blob,
): Promise<{ blob: Blob; format: ThumbFormat } | null> {
  try {
    return await withTimeout(buildThumbnail(source), THUMBNAIL_TIMEOUT_MS, "thumbnail");
  } catch (error) {
    // The one outcome the guest must never notice: no thumbnail simply means
    // the grid asks Cloudflare to make one, exactly as it did before any of
    // this existed.
    console.warn(`${LOG_PREFIX} no thumbnail, the grid will use the CDN instead:`, error);
    return null;
  }
}

async function buildThumbnail(source: Blob): Promise<{ blob: Blob; format: ThumbFormat } | null> {
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") return null;

  let bitmap: ImageBitmap | null = null;
  try {
    // Decoding happens off the main thread, and EXIF orientation is applied —
    // a portrait shot from a phone must not come out on its side.
    bitmap = await createImageBitmap(source);
    const size = thumbSize(bitmap.width, bitmap.height);

    // A plain canvas rather than OffscreenCanvas: Safari only got the latter in
    // 16.4, and this path should reach as many phones as possible.
    let canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;

    // pica resamples properly (Lanczos-family with mild sharpening) in a
    // worker. Scaling 4000 px straight to 512 px with one drawImage aliases
    // badly on detailed subjects — lace, foliage — which is most of a wedding.
    const pica = await loadPica();
    let resized = false;
    if (pica) {
      try {
        await withTimeout(pica.resize(bitmap, canvas), PICA_RESIZE_TIMEOUT_MS, "pica resize");
        resized = true;
      } catch (error) {
        // A late completion would draw into a canvas nobody reads any more, so
        // the fallback below gets a fresh one rather than racing this.
        disablePica(error);
      }
    }

    if (!resized) {
      const fallback = document.createElement("canvas");
      fallback.width = size.width;
      fallback.height = size.height;
      const context = fallback.getContext("2d");
      if (!context) return null;
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(bitmap, 0, 0, size.width, size.height);
      canvas = fallback;
    }

    // WebP first, JPEG where it is not available (Safari before 14, old Android
    // WebViews). A browser that cannot encode the type it was asked for hands
    // back a PNG, which would be larger than the original and stored under the
    // wrong content type — hence checking the type it actually produced.
    for (const format of ["webp", "jpeg"] as const) {
      const type = THUMB_CONTENT_TYPES[format];
      const quality = format === "webp" ? WEBP_QUALITY : JPEG_QUALITY;
      const blob = await canvasToBlob(canvas, type, quality);
      if (!blob || blob.type !== type) continue;
      // If the "thumbnail" is not smaller, it has no reason to exist.
      if (blob.size >= source.size) return null;
      return { blob, format };
    }

    console.warn(`${LOG_PREFIX} no usable encoding, the grid will use the CDN instead`);
    return null;
  } catch (error) {
    console.warn(`${LOG_PREFIX} thumbnail failed, the grid will use the CDN instead:`, error);
    return null;
  } finally {
    bitmap?.close();
  }
}
