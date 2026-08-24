/**
 * Geometry for the lightbox's pinch/double-tap zoom.
 *
 * Kept away from the component because every one of these is a place a photo
 * viewer goes subtly wrong — the image drifting out from under the fingers, or
 * panning past its own edge into the letterboxing — and all of it is pure
 * arithmetic that a test can pin down.
 *
 * Coordinates are relative to the *centre* of the container, which is where
 * the CSS transform origin sits: `translate(pan) scale(scale)` on an element
 * that fills the container.
 */

/** Beyond this the transformed thumbnail is mush; further zoom buys nothing. */
export const MAX_SCALE = 4;

/** Where a double tap lands — enough to check a face, not so far that the
 * viewer is lost inside the photo with no way back but another double tap. */
export const DOUBLE_TAP_SCALE = 2.5;

/** Below this a gesture has effectively returned to "not zoomed", and the
 * viewer means to be back at the fitted photo rather than 1.02× of it. */
export const ZOOM_EPSILON = 0.02;

export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * The rectangle an `object-contain` image actually occupies inside its
 * container. The photo, not the container, is what the viewer pans — the
 * difference is the letterboxing, which nobody wants to drag into view.
 */
export function containedSize(container: Size, aspect: number): Size {
  if (container.width <= 0 || container.height <= 0 || !(aspect > 0)) {
    return { width: 0, height: 0 };
  }
  const fitsByWidth = container.width / aspect <= container.height;
  return fitsByWidth
    ? { width: container.width, height: container.width / aspect }
    : { width: container.height * aspect, height: container.height };
}

export function clampScale(scale: number): number {
  if (!Number.isFinite(scale)) return 1;
  return clamp(scale, 1, MAX_SCALE);
}

/** True once a scale is far enough above 1 to count as zoomed in. */
export function isZoomed(scale: number): boolean {
  return scale > 1 + ZOOM_EPSILON;
}

/**
 * How far the scaled photo may travel in each axis before its own edge would
 * come inside the frame. Zero on an axis the photo doesn't overflow, which is
 * what keeps a portrait photo from sliding sideways on a wide screen.
 */
export function panBounds(container: Size, aspect: number, scale: number): Size {
  const fitted = containedSize(container, aspect);
  return {
    width: Math.max(0, (fitted.width * scale - container.width) / 2),
    height: Math.max(0, (fitted.height * scale - container.height) / 2),
  };
}

export function clampPan(pan: Point, container: Size, aspect: number, scale: number): Point {
  const bounds = panBounds(container, aspect, scale);
  return {
    x: clamp(pan.x, -bounds.width, bounds.width),
    y: clamp(pan.y, -bounds.height, bounds.height),
  };
}

/**
 * The pan that keeps whatever is under `focus` under `focus` while the scale
 * changes from `from` to `to`.
 *
 * A point p on screen maps to the image point `(p - pan) / scale`. Holding
 * that constant across the two scales and solving for the new pan is this
 * one line — without it, pinching drags the photo away from the fingers.
 */
export function zoomAround(focus: Point, pan: Point, from: number, to: number): Point {
  if (from <= 0) return pan;
  const ratio = to / from;
  return {
    x: focus.x - ratio * (focus.x - pan.x),
    y: focus.y - ratio * (focus.y - pan.y),
  };
}

/** Straight-line distance, for reading a pinch off two pointers. */
export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
