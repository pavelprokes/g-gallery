/**
 * The one place the image variant set is defined.
 *
 * Every (photo × width × quality) combination is a billable Cloudflare
 * transformation against a 5,000/month allowance, so the list is deliberately
 * short — Next.js would otherwise generate 16 widths and quadruple the burn
 * (docs/PLAN.md §6).
 *
 * `next.config.ts` and the lightbox prefetch both read from here. If they
 * disagree, the prefetch fetches a variant the browser will not use: the swipe
 * stays slow *and* the transformation is billed twice.
 */

/** Widths offered for full-width images (the lightbox, `sizes="100vw"`). */
export const DEVICE_SIZES = [640, 1080, 1920, 2560] as const;

/** Widths offered for thumbnails, which never need more than a grid cell. */
export const IMAGE_SIZES = [384] as const;

export const QUALITY = 82;

/** Everything a `srcset` for a full-width image may contain, ascending. */
export const ALL_WIDTHS = [...IMAGE_SIZES, ...DEVICE_SIZES].sort((a, b) => a - b);

/**
 * Builds the same `srcset` Next.js emits for `sizes="100vw"`, so a preload
 * link with `imagesrcset`/`imagesizes` resolves to the identical candidate the
 * real `<img>` will pick. Choosing the width ourselves would be a guess about
 * the browser's selection algorithm; letting it choose is exact.
 */
export function fullWidthSrcSet(
  src: string,
  loader: (args: { src: string; width: number; quality?: number }) => string,
): string {
  return DEVICE_SIZES.map((width) => `${loader({ src, width, quality: QUALITY })} ${width}w`).join(
    ", ",
  );
}
