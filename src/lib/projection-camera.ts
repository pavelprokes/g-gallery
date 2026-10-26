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
import { aimFaces } from "@/lib/social-video/aim";
import { focusFaces, type Box } from "@/lib/social-video/face-tags";
import { storedFaces, type Face } from "@/lib/social-video/faces";
import type { Focus } from "@/lib/social-video/focus";

/** The most faces a photo hands the guests' page — enough to frame any
 * group; the camera only needs the ones it frames by. */
const MAX_PROJECTED_FACES = 24;

/** Keyframes per slide: the camera's own easing, sampled finely enough that
 * the straight lines between them do not show. */
const STEPS = 24;

/** What `projectionFaces` reads off a photo row: its faces, and the boxes named
 * as the couple — the boxes only, never who. */
export const PROJECTION_FACES_SELECT = {
  faces: true,
  faceTags: { where: { person: { couple: true } }, select: { x: true, y: true, w: true, h: true } },
} as const;

/**
 * The faces a guest's page needs for the projection's camera: the boxes the
 * camera frames by, rounded, without the blink and sharpness scores — only the
 * couple's where the photographer named them (`coupleTags`, docs/SOCIAL-VIDEO.md
 * §4), so the camera lands on them in a group. Never a name: a box is all
 * that leaves the server. Any stored detection serves — a box is a box,
 * whichever build found it. Null when the photo's faces were never searched.
 */
export function projectionFaces(stored: unknown, coupleTags: readonly Box[] = []): Face[] | null {
  return projectionAim(stored, coupleTags).faces;
}

/** The sharp part the projection's camera aims at without a face to frame
 * (docs/SOCIAL-VIDEO.md §5): a box, rounded; null when there is none. */
export function projectionFocus(stored: unknown): Focus | null {
  return projectionAim(stored).focus;
}

/** Both, from one parse of the stored value — what a guest's page gets per photo. */
export function projectionAim(
  stored: unknown,
  coupleTags: readonly Box[] = [],
): { faces: Face[] | null; focus: Focus | null } {
  const parsed = storedFaces(stored);
  if (!parsed) return { faces: null, focus: null };
  const r = (n: number) => Math.round(n * 1000) / 1000;
  // Soft faces in front of a sharp detail are not what the camera frames by —
  // decided here, where the eyes' sharpness still is (docs/SOCIAL-VIDEO.md §5).
  const faces = aimFaces(focusFaces(parsed.faces, coupleTags), parsed.focus)
    .filter((f) => f.score >= FRAMING_MIN_SCORE)
    .sort((a, b) => b.w * b.h - a.w * a.h)
    .slice(0, MAX_PROJECTED_FACES)
    .map((f) => ({
      x: r(f.x),
      y: r(f.y),
      w: r(f.w),
      h: r(f.h),
      score: r(f.score),
      le: [r(f.le[0]), r(f.le[1])] as [number, number],
      re: [r(f.re[0]), r(f.re[1])] as [number, number],
      blink: null,
    }));
  const f = parsed.focus;
  return {
    faces,
    focus: f ? { x: r(f.x), y: r(f.y), w: r(f.w), h: r(f.h), strength: f.strength } : null,
  };
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
  photo: {
    width: number | null;
    height: number | null;
    faces: readonly Face[] | null;
    focus?: Focus | null;
  },
  screen: { width: number; height: number },
  seconds: number,
  turn: number,
): Shot | null {
  const { width, height, faces } = photo;
  if (!width || !height || !faces || screen.width <= 0 || screen.height <= 0) return null;
  if (width >= height !== screen.width >= screen.height) return null;
  const shot = planShot(
    { width, height, faces, focus: photo.focus },
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
