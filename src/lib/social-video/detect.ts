"use client";

// Face detection in the admin's browser (docs/SOCIAL-VIDEO.md §4): MediaPipe's
// short-range BlazeFace over the whole photo and its tiles, plus Face
// Landmarker for the blink score. Loaded on first use only — the WASM is
// ~13 MB — and from our own origin (scripts/copy-mediapipe.mjs).
//
// It runs on the main thread, one photo at a time with a yield between them:
// ~0.2 s per photo on a laptop, a dozen photos per video. A worker would keep
// even that off the page; it is the next step if it shows (§9.5).

import type { Detection } from "@mediapipe/tasks-vision";
import {
  attachBlinks,
  FACES_MODEL,
  FRAME_MIN_SCORE,
  mergeDetections,
  tilesFor,
  type PhotoFaces,
  type TileDetection,
} from "@/lib/social-video/faces";

/** Must match package.json — the WASM is served from a path with it. */
export const MEDIAPIPE_VERSION = "1.1.1";

const WASM_PATH = `/vendor/mediapipe/${MEDIAPIPE_VERSION}/wasm`;
const DETECTOR_MODEL = "/vendor/mediapipe/models/face_detector.tflite";
const LANDMARKER_MODEL = "/vendor/mediapipe/models/face_landmarker.task";

/** Faces the landmarker looks for at most — enough for any photo whose blink
 * matters (a portrait, a couple, a small group). */
const LANDMARKER_FACES = 12;

export interface FaceFinder {
  /** The faces in a decoded photo, ready to store. */
  find(image: ImageBitmap): PhotoFaces;
  close(): void;
}

/** MediaPipe's detection as the merge wants it; null without a box or two eyes. */
export function toTileDetection(d: Detection): TileDetection | null {
  const box = d.boundingBox;
  const [a, b] = d.keypoints;
  if (!box || !a || !b) return null;
  return {
    box: { x: box.originX, y: box.originY, w: box.width, h: box.height },
    score: d.categories[0]?.score ?? 0,
    eyes: [
      { x: a.x, y: a.y },
      { x: b.x, y: b.y },
    ],
  };
}

export async function createFaceFinder(): Promise<FaceFinder> {
  const { FaceDetector, FaceLandmarker, FilesetResolver } = await import("@mediapipe/tasks-vision");
  const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
  const detector = await FaceDetector.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: DETECTOR_MODEL },
    runningMode: "IMAGE",
    // Tiles apply their own, stricter bar in mergeDetections.
    minDetectionConfidence: FRAME_MIN_SCORE,
  });
  const landmarker = await FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: LANDMARKER_MODEL },
    runningMode: "IMAGE",
    numFaces: LANDMARKER_FACES,
    outputFaceBlendshapes: true,
  });
  const tileCanvas = document.createElement("canvas");
  const tileCtx = tileCanvas.getContext("2d");
  if (!tileCtx) throw new Error("NO_CANVAS");

  return {
    find(image) {
      const { width, height } = image;
      const passes = tilesFor(width, height).map((tile) => {
        tileCanvas.width = Math.round(tile.w);
        tileCanvas.height = Math.round(tile.h);
        tileCtx.drawImage(image, tile.x, tile.y, tile.w, tile.h, 0, 0, tile.w, tile.h);
        const detections = detector
          .detect(tileCanvas)
          .detections.map(toTileDetection)
          .filter((d): d is TileDetection => d !== null);
        return { tile, detections };
      });
      const faces = mergeDetections(width, height, passes);

      const marked = landmarker.detect(image);
      const landmarked = marked.faceLandmarks.map((points, i) => {
        const xs = points.map((p) => p.x);
        const ys = points.map((p) => p.y);
        const blink = Math.max(
          0,
          ...(marked.faceBlendshapes[i]?.categories ?? [])
            .filter((c) => c.categoryName.startsWith("eyeBlink"))
            .map((c) => c.score),
        );
        const x = Math.min(...xs);
        const y = Math.min(...ys);
        return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y, blink };
      });

      return { v: 1, model: FACES_MODEL, faces: attachBlinks(faces, landmarked) };
    },
    close() {
      detector.close();
      landmarker.close();
    },
  };
}
