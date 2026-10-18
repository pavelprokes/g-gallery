// The party projection's camera (docs/GUEST-GALLERIES.md, "F5 projection"):
// the social video's face-aware move (docs/SOCIAL-VIDEO.md §5) on the venue's
// screen. Pure and client-safe; the slideshow turns a shot into an animation
// of a CSS transform, so the browser's compositor moves the photo and nothing
// is drawn frame by frame.

import {
  cameraAt,
  FRAMING_MIN_SCORE,
  planShot,
  type Rect,
  type Shot,
  type VideoFormat,
} from "@/lib/social-video/camera";
import { photoFacesSchema, type Face } from "@/lib/social-video/faces";

/** The most faces a photo hands the guests' page — enough to frame any
 * group; the camera only needs the ones it frames by. */
const MAX_PROJECTED_FACES = 24;

/** Keyframes per slide: the camera's own easing, sampled finely enough that
 * the straight lines between them do not show. */
const STEPS = 24;

/**
 * The faces a guest's page needs for the projection's camera: the boxes the
 * camera frames by, rounded, without the blink and sharpness scores. Any
 * stored detection serves — a box is a box, whichever build found it. Null
 * when the photo's faces were never searched.
 */
export function projectionFaces(stored: unknown): Face[] | null {
  const parsed = photoFacesSchema.safeParse(stored);
  if (!parsed.success) return null;
  const r = (n: number) => Math.round(n * 1000) / 1000;
  return parsed.data.faces
    .filter((f) => f.score >= FRAMING_MIN_SCORE)
    .sort((a, b) => b.w * b.h - a.w * a.h)
    .slice(0, MAX_PROJECTED_FACES)
    .map((f) => ({
      x: r(f.x),
      y: r(f.y),
      w: r(f.w),
      h: r(f.h),
      score: r(f.score),
      le: [r(f.le[0]), r(f.le[1])],
      re: [r(f.re[0]), r(f.re[1])],
      blink: null,
    }));
}

/** The screen as a camera format: a gentle zoom, the eyes a little above the
 * middle, no caption to keep clear of. */
export function screenFormat(width: number, height: number): VideoFormat {
  return {
    aspect: width >= height ? "16:9" : "9:16",
    width,
    height,
    maxZoom: 1.25,
    eyeLine: 0.4,
    safe: { x0: 0, x1: 1, y0: 0, y1: 1 },
  };
}

/**
 * The move for one photo on a `screen`, or null to show it whole and still:
 * faces never searched, a photo of the other orientation than the screen (a
 * portrait cut to a landscape band would lose the people the photographer
 * framed), or a group the camera can only show whole. `turn` alternates
 * pushing in and pulling out, as the video does; groups always pull out.
 */
export function projectionShot(
  photo: { width: number | null; height: number | null; faces: readonly Face[] | null },
  screen: { width: number; height: number },
  seconds: number,
  turn: number,
): Shot | null {
  const { width, height, faces } = photo;
  if (!width || !height || !faces || screen.width <= 0 || screen.height <= 0) return null;
  if (width >= height !== screen.width >= screen.height) return null;
  const shot = planShot(
    { width, height, faces },
    screenFormat(screen.width, screen.height),
    seconds,
  );
  if (shot.kind === "fit") return null;
  if (shot.kind === "pan") return turn % 2 ? { ...shot, from: shot.to, to: shot.from } : shot;
  const pullOut = faces.length >= 3 || turn % 2 === 1;
  return pullOut ? { kind: "pull", from: shot.to, to: shot.from } : shot;
}

/**
 * The shot as transforms of an element the photo's size in CSS pixels
 * (`width` × `height`, origin top left): each keyframe scales the camera's
 * rectangle to the screen's width and moves it to the corner.
 */
export function shotKeyframes(shot: Shot, screenWidth: number): { transform: string }[] {
  return Array.from({ length: STEPS + 1 }, (_, i) =>
    transformFor(cameraAt(shot, i / STEPS), screenWidth),
  );
}

export function transformFor(rect: Rect, screenWidth: number): { transform: string } {
  const k = screenWidth / rect.w;
  const px = (n: number) => `${Math.round(n * 100) / 100}px`;
  return {
    transform: `translate(${px(-rect.x * k)}, ${px(-rect.y * k)}) scale(${Math.round(k * 1e5) / 1e5})`,
  };
}
