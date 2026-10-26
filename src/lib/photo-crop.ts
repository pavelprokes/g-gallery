// A crop of one photo at a given aspect and size, aimed the way the social
// video's camera aims (docs/MCP.md §Crops): the couple's faces when they are
// named, else every face it would frame by, else the sharp part, else the upper
// third. Pure; every rectangle is in the photo's own pixels.

import { framedFaces, subjectOf, type Rect } from "@/lib/social-video/camera";
import { aimFaces } from "@/lib/social-video/aim";
import { coupleFaces, focusFaces, type Box } from "@/lib/social-video/face-tags";
import type { Face } from "@/lib/social-video/faces";
import type { Focus } from "@/lib/social-video/focus";

export interface CropPhoto {
  width: number;
  height: number;
  faces: readonly Face[];
  focus?: Focus | null;
  /** Face boxes named as the couple (FaceTag with `person.couple`). */
  coupleTags: readonly Box[];
}

/**
 * - `photo`: the largest crop of the aspect — as much of the photo as fits;
 * - `subject`: tight around who or what the photo is of, with air, never
 *   smaller than the output unless upscaling is allowed.
 */
export type Framing = "photo" | "subject";

export interface CropRequest {
  /** Width over height; null keeps the photo's own. */
  aspect: number | null;
  framing: Framing;
  maxWidth: number | null;
  maxHeight: number | null;
  allowUpscale: boolean;
}

export type Aim = "couple" | "faces" | "focus" | "default";

export interface CropPlan {
  rect: Rect;
  output: { width: number; height: number };
  aim: Aim;
  upscaled: boolean;
  /** Framed faces in the photo, and how many of them the crop cuts. */
  faces: { framed: number; cut: number; coupleCut: number };
  warnings: string[];
}

/** Aspects a client may name; any other "W:H" is accepted too. */
export const NAMED_ASPECTS: Record<string, number> = {
  "4:5": 4 / 5,
  "1:1": 1,
  "1.91:1": 1.91,
  "9:16": 9 / 16,
  "16:9": 16 / 9,
  "3:4": 3 / 4,
  "4:3": 4 / 3,
  "2:3": 2 / 3,
  "3:2": 3 / 2,
};

export const MIN_ASPECT = 0.25;
export const MAX_ASPECT = 4;

/** Where the eyes sit in a still, from the top: a third in an upright frame,
 * a little lower in a wide one. */
const EYE_LINE_UPRIGHT = 1 / 3;
const EYE_LINE_WIDE = 0.4;

/** Without a subject the crop keeps the upper third — at a wedding the heads
 * are there far more often than in the middle (camera.ts, FACELESS_AIM). */
const DEFAULT_AIM_Y = 1 / 3;

/** Air around the subject in a `subject` crop. */
const SUBJECT_MARGIN = 1.3;

/** A face counts as cut when less than this share of its box is inside. */
const KEPT_SHARE = 0.9;

/** "4:5", "1.91:1", "original" → width over height (null = the photo's own). */
export function parseAspect(value: string): number | null {
  if (value === "original") return null;
  const named = NAMED_ASPECTS[value];
  if (named) return named;
  const match = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(value);
  if (!match) throw new Error("ASPECT");
  const aspect = Number(match[1]) / Number(match[2]);
  if (!Number.isFinite(aspect) || aspect < MIN_ASPECT || aspect > MAX_ASPECT)
    throw new Error("ASPECT");
  return aspect;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), Math.max(min, max));
}

function share(face: Face, rect: Rect, W: number, H: number): number {
  const x0 = Math.max(face.x * W, rect.x);
  const y0 = Math.max(face.y * H, rect.y);
  const x1 = Math.min((face.x + face.w) * W, rect.x + rect.w);
  const y1 = Math.min((face.y + face.h) * H, rect.y + rect.h);
  const area = face.w * W * face.h * H;
  return x1 > x0 && y1 > y0 && area > 0 ? ((x1 - x0) * (y1 - y0)) / area : 0;
}

/** Whole pixels, inside the photo, at the aspect (to the pixel). */
function snap(rect: Rect, W: number, H: number, aspect: number): Rect {
  let w = Math.max(1, Math.min(W, Math.round(rect.w)));
  let h = Math.max(1, Math.round(w / aspect));
  if (h > H) {
    h = H;
    w = Math.max(1, Math.min(W, Math.round(H * aspect)));
  }
  return {
    x: clamp(Math.round(rect.x), 0, W - w),
    y: clamp(Math.round(rect.y), 0, H - h),
    w,
    h,
  };
}

export function planCrop(photo: CropPhoto, request: CropRequest): CropPlan {
  const { width: W, height: H } = photo;
  const a = request.aspect ?? W / H;
  const warnings: string[] = [];

  const couple = coupleFaces(photo.faces, photo.coupleTags);
  const aimed = aimFaces(focusFaces(photo.faces, photo.coupleTags), photo.focus);
  const subject = subjectOf({ width: W, height: H, faces: aimed });
  const focus = !subject && photo.focus ? photo.focus : null;
  const aim: Aim = subject ? (couple.length > 0 ? "couple" : "faces") : focus ? "focus" : "default";

  // The output box the crop is shrunk into; without a limit, 1080 wide.
  const limitW = request.maxWidth ?? (request.maxHeight ? Infinity : 1080);
  const limitH = request.maxHeight ?? Infinity;
  const coverW = Math.min(W, H * a);

  let w = coverW;
  if (request.framing === "subject" && (subject || focus)) {
    const need = subject
      ? Math.max(subject.box.w, subject.box.h * a)
      : Math.max(focus!.w * W, focus!.h * H * a);
    // Not below the output's own width: a tight crop must not be enlarged.
    const outputW = Math.min(limitW, limitH * a);
    const floor = request.allowUpscale ? 1 : Math.min(coverW, outputW);
    w = clamp(need * SUBJECT_MARGIN, floor, coverW);
  }
  const h = w / a;

  let x: number;
  let y: number;
  if (subject) {
    const { box, eyeY } = subject;
    x = box.x + box.w / 2 - w / 2;
    if (box.w <= w) x = clamp(x, box.x + box.w - w, box.x);
    y = eyeY - (a <= 1 ? EYE_LINE_UPRIGHT : EYE_LINE_WIDE) * h;
    // The heads come first: never cut the top of one to place the eyes.
    if (box.y < y) y = box.y;
    if (box.h <= h) y = clamp(y, box.y + box.h - h, box.y);
  } else if (focus) {
    x = (focus.x + focus.w / 2) * W - w / 2;
    y = (focus.y + focus.h / 2) * H - h / 2;
  } else {
    x = W / 2 - w / 2;
    y = H * DEFAULT_AIM_Y - h / 2;
  }
  const rect = snap({ x, y, w, h }, W, H, a);

  const framed = framedFaces(photo.faces);
  const cut = framed.filter((face) => share(face, rect, W, H) < KEPT_SHARE);
  const coupleCut = couple.filter((face) => share(face, rect, W, H) < KEPT_SHARE);
  if (coupleCut.length > 0) {
    warnings.push("Ořez usekne někoho z páru — zkus širší poměr nebo framing photo.");
  } else if (cut.length > 0) {
    warnings.push(
      `Ořez usekne ${cut.length} z ${framed.length} obličejů — zkus širší poměr, pokud mají být všichni vidět.`,
    );
  }

  const fit = Math.min(limitW / rect.w, limitH / rect.h);
  const scale = request.allowUpscale ? fit : Math.min(1, fit);
  const outW = Math.max(1, Math.round(rect.w * scale));
  const outH = Math.max(1, Math.round(outW / a));
  if (!request.allowUpscale && fit > 1) {
    warnings.push(
      `Výřez má jen ${rect.w} × ${rect.h} px, menší než požadovaná velikost — nezvětšuji ho (allow_upscale).`,
    );
  }
  return {
    rect,
    output: { width: outW, height: outH },
    aim,
    upscaled: scale > 1,
    faces: { framed: framed.length, cut: cut.length, coupleCut: coupleCut.length },
    warnings,
  };
}
