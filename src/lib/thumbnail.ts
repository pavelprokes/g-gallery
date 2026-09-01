import { withTimeout } from "@/lib/with-timeout";

/**
 * The grid thumbnail the browser makes for itself (docs/GUEST-GALLERIES.md §9),
 * on both the guest path and the photographer's own upload — see
 * `ThumbProfile` for why the two are not the same size.
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

/**
 * Which grid the thumbnail is for. The two differ only in how big the tile
 * gets on screen, which is enough to want different pixels:
 *
 * - `guest` — the wedding-day feed, looked at on the phone that shot it. A
 *   two-column grid at 2× lands inside 512 px.
 * - `owner` — the delivery gallery the couple browses on a laptop. A desktop
 *   tile is ~330 CSS px, i.e. **660 device px on a 2× display**, so a 512 px
 *   thumbnail was being upscaled ~1.29× — and the grid is where the couple
 *   decides whether the photographer is sharp, before they open anything.
 */
export type ThumbProfile = "owner" | "guest";

/** Long edge in pixels. Covers a two-column grid at 2× without visible softness. */
export const THUMB_MAX_PX = 512;

/**
 * Long edge for the desktop delivery grid: 1024 covers a ~330 CSS px tile at
 * 2× with headroom, instead of upscaling into it.
 */
export const OWNER_THUMB_MAX_PX = 1024;

interface ThumbProfileSettings {
  /** Long edge cap handed to `thumbSize`. */
  maxPx: number;
  webpQuality: number;
  /** JPEG needs a touch more than WebP to avoid ringing on the same content. */
  jpegQuality: number;
}

/**
 * Four times the pixels are paid for with quality, not with bytes: 0.72 → 0.65
 * on the owner path. This is the "compressive images" trade — a larger image at
 * a lower quality is both smaller on the wire and perceptibly sharper on a 2×
 * display, because the JPEG/WebP artefacts land below one device pixel.
 *
 * The cost that is *not* bytes: **decode memory**. A 500-photo grid of 1024 px
 * thumbnails holds roughly 4× the bitmap memory of today's 512 px ones, so if
 * anything regresses on a low-end phone scrolling a large owner gallery, this
 * is the line to look at first.
 *
 * The JPEG fallback takes the same 0.07 drop, keeping the gap that stops JPEG
 * ringing where WebP is clean.
 */
export const THUMB_PROFILES: Record<ThumbProfile, ThumbProfileSettings> = {
  owner: { maxPx: OWNER_THUMB_MAX_PX, webpQuality: 0.65, jpegQuality: 0.71 },
  guest: { maxPx: THUMB_MAX_PX, webpQuality: 0.72, jpegQuality: 0.78 },
};

/**
 * Post-resize sharpening, identical on both paths.
 *
 * `filter` is pinned to pica's own default rather than left implicit: pica's
 * README says `mks2013` (Magic Kernel Sharp 2013) "does both resize and
 * sharpening, it's optimal and not recommended to change", so lanczos3 is not
 * an upgrade here — and pinning means a future change to pica's default cannot
 * quietly change what every gallery looks like.
 *
 * Because mks2013 already sharpens, the README's standalone starting point of
 * `unsharpAmount: 160` does not apply — that number assumes an unsharpened
 * filter and would visibly over-sharpen on top of this one.
 *
 * - `unsharpAmount` is a **percentage, exactly like Photoshop's Amount %** —
 *   pica computes `amountFp = amount / 100 * 4096`. It runs *after* the resize
 *   and only on the **HSV V channel**, so hue and saturation are untouched,
 *   which is what makes it safe on skin.
 * - `unsharpRadius` is valid in 0.5–2.0 and **silently switches the unsharp
 *   mask off below 0.5**. 0.6 is pica's own suggested radius.
 * - `unsharpThreshold` is 0–255; 2 keeps sensor noise and smooth skin out of
 *   the sharpening, mirroring SmugMug's non-zero threshold and libvips'
 *   `m1 = 0` ("no sharpening in flat areas") screen-output default.
 *
 * **60 is triangulated, not vendor-published** — nobody publishes a number for
 * "mks2013 + unsharp". It is the top of a sensible 40–80 band derived from the
 * three vendors that do publish, all of them gentle: Cloudflare recommends
 * `sharpen=1` on a 0–10 scale for downscaled images, SmugMug uses Amount 0.200
 * after Lanczos, libvips ships `m1=0, m2=3` for screen output. The failure mode
 * to watch for when tuning inside that band is **halos on skin and along a veil
 * edge, which are worse than softness** (docs/PLAN.md §6).
 */
export const THUMB_RESIZE_OPTIONS = {
  filter: "mks2013",
  unsharpAmount: 60,
  unsharpRadius: 0.6,
  unsharpThreshold: 2,
} as const;

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

/**
 * Only the fields this module uses. The unsharp trio has to be here or
 * `THUMB_RESIZE_OPTIONS` would not type-check against it.
 */
interface PicaResizeOptions {
  filter?: string;
  unsharpAmount?: number;
  unsharpRadius?: number;
  unsharpThreshold?: number;
}

type PicaResize = (
  from: ImageBitmap,
  to: HTMLCanvasElement,
  options?: PicaResizeOptions,
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
  profile: ThumbProfile = "guest",
): Promise<{ blob: Blob; format: ThumbFormat } | null> {
  try {
    return await withTimeout(buildThumbnail(source, profile), THUMBNAIL_TIMEOUT_MS, "thumbnail");
  } catch (error) {
    // The one outcome the guest must never notice: no thumbnail simply means
    // the grid asks Cloudflare to make one, exactly as it did before any of
    // this existed.
    console.warn(`${LOG_PREFIX} no thumbnail, the grid will use the CDN instead:`, error);
    return null;
  }
}

async function buildThumbnail(
  source: Blob,
  profile: ThumbProfile,
): Promise<{ blob: Blob; format: ThumbFormat } | null> {
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") return null;

  const settings = THUMB_PROFILES[profile];

  let bitmap: ImageBitmap | null = null;
  try {
    // Decoding happens off the main thread, and EXIF orientation is applied —
    // a portrait shot from a phone must not come out on its side.
    bitmap = await createImageBitmap(source);
    const size = thumbSize(bitmap.width, bitmap.height, settings.maxPx);

    // A plain canvas rather than OffscreenCanvas: Safari only got the latter in
    // 16.4, and this path should reach as many phones as possible.
    let canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;

    // pica resamples properly (mks2013, which resizes and sharpens in one
    // pass) in a worker, plus the gentle unsharp pass in THUMB_RESIZE_OPTIONS.
    // Scaling 4000 px straight to the tile with one drawImage aliases badly on
    // detailed subjects — lace, foliage — which is most of a wedding.
    const pica = await loadPica();
    let resized = false;
    if (pica) {
      try {
        await withTimeout(
          pica.resize(bitmap, canvas, { ...THUMB_RESIZE_OPTIONS }),
          PICA_RESIZE_TIMEOUT_MS,
          "pica resize",
        );
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
      const quality = format === "webp" ? settings.webpQuality : settings.jpegQuality;
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
