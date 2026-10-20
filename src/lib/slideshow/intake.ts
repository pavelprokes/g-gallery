"use client";

// A visitor's photo, made ready in their own browser (docs/SLIDESHOW-MAKER.md
// §3): checked, turned upright, shrunk to what the video can use and
// re-encoded — which also drops every EXIF tag, GPS included. Nothing here
// talks to a server.

import { readTakenAtFromJpeg, EXIF_SCAN_BYTES } from "@/lib/exif-taken-at";
import {
  fileProblem,
  sizeProblem,
  type FileProblem,
  type SizeProblem,
} from "@/lib/slideshow/limits";

/**
 * The longest side kept. `sourceWidth` (src/lib/social-video/camera.ts) asks
 * a 3:2 landscape photo for 2880 px to cover a 1080 × 1920 frame — the most
 * either format needs from an ordinary photo.
 */
export const INTAKE_MAX_EDGE = 2880;
const THUMB_EDGE = 360;

export interface PreparedPhoto {
  id: string;
  name: string;
  takenAt: number | null;
  /** The kept size — what the camera plans in. */
  width: number;
  height: number;
  blob: Blob;
  /** Object URLs, revoked by whoever drops the photo. */
  url: string;
  thumbUrl: string;
}

export type IntakeProblem = FileProblem | SizeProblem | "unreadable";

export type IntakeResult =
  { ok: true; photo: PreparedPhoto } | { ok: false; name: string; problem: IntakeProblem };

async function takenAt(file: File): Promise<number | null> {
  if (file.type !== "image/jpeg") return null;
  try {
    const head = new Uint8Array(await file.slice(0, EXIF_SCAN_BYTES).arrayBuffer());
    return readTakenAtFromJpeg(head)?.getTime() ?? null;
  } catch {
    return null;
  }
}

async function shrink(image: ImageBitmap, edge: number, quality: number) {
  const k = Math.min(1, edge / Math.max(image.width, image.height));
  const width = Math.round(image.width * k);
  const height = Math.round(image.height * k);
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("NO_CANVAS");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, 0, 0, width, height);
  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality });
  return { blob, width, height };
}

export async function preparePhoto(file: File, id: string): Promise<IntakeResult> {
  const name = file.name;
  const early = fileProblem(file);
  if (early) return { ok: false, name, problem: early };

  let image: ImageBitmap;
  try {
    image = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return { ok: false, name, problem: "unreadable" };
  }
  try {
    const problem = sizeProblem(image.width, image.height);
    if (problem) return { ok: false, name, problem };
    const [kept, thumb, when] = await Promise.all([
      shrink(image, INTAKE_MAX_EDGE, 0.9),
      shrink(image, THUMB_EDGE, 0.8),
      takenAt(file),
    ]);
    return {
      ok: true,
      photo: {
        id,
        name,
        takenAt: when,
        width: kept.width,
        height: kept.height,
        blob: kept.blob,
        url: URL.createObjectURL(kept.blob),
        thumbUrl: URL.createObjectURL(thumb.blob),
      },
    };
  } catch {
    return { ok: false, name, problem: "unreadable" };
  } finally {
    image.close();
  }
}

/** Shot order: capture time where the camera wrote one, then the file name. */
export function byTakenAt(a: PreparedPhoto, b: PreparedPhoto): number {
  if (a.takenAt !== null && b.takenAt !== null && a.takenAt !== b.takenAt) {
    return a.takenAt - b.takenAt;
  }
  if (a.takenAt !== null && b.takenAt === null) return -1;
  if (a.takenAt === null && b.takenAt !== null) return 1;
  return byName(a, b);
}

export function byName(a: { name: string }, b: { name: string }): number {
  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
}
