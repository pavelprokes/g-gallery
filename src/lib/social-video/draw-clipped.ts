// `drawImage` with a source rectangle, safe in every browser. WebKit (Safari,
// every iOS browser) draws nothing at all when the source rectangle reaches
// past an ImageBitmap's edge — by a pixel, by 0.3 px, or from −0.5 — where
// Chrome clips it. A reel's still frame spans the photo's whole height, so a
// transform's rounding put whole slides to black in Safari (Pavel's 30 s
// reels, 2026-10-29; measured in WebKitGTK 2.52); the face scan's second look
// near a photo's edge saw nothing there either.

export interface DrawSource {
  width: number;
  height: number;
}

/** A 2D context's nine-argument `drawImage`, for a canvas or an OffscreenCanvas. */
export interface ClippedTarget {
  drawImage(
    image: CanvasImageSource,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The part of `from` (in the image's pixels) that lies on the image, and
 * where it lands in `to` — as `drawImage` maps the whole of `from` onto the
 * whole of `to`. Null when none of it is on the image.
 */
export function clipSource(
  image: DrawSource,
  from: Rect,
  to: Rect,
): { from: Rect; to: Rect } | null {
  const x0 = Math.max(0, from.x);
  const y0 = Math.max(0, from.y);
  const x1 = Math.min(image.width, from.x + from.w);
  const y1 = Math.min(image.height, from.y + from.h);
  if (!(x1 > x0 && y1 > y0) || from.w <= 0 || from.h <= 0) return null;
  const kx = to.w / from.w;
  const ky = to.h / from.h;
  return {
    from: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 },
    to: {
      x: to.x + (x0 - from.x) * kx,
      y: to.y + (y0 - from.y) * ky,
      w: (x1 - x0) * kx,
      h: (y1 - y0) * ky,
    },
  };
}

/** `ctx.drawImage(image, from…, to…)`, with `from` clipped to the image first. */
export function drawClipped(
  ctx: ClippedTarget,
  image: CanvasImageSource & DrawSource,
  from: Rect,
  to: Rect,
): void {
  const clipped = clipSource(image, from, to);
  if (!clipped) return;
  const { from: f, to: t } = clipped;
  ctx.drawImage(image, f.x, f.y, f.w, f.h, t.x, t.y, t.w, t.h);
}
