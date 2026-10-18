"use client";

// Face detection in the admin's browser (docs/SOCIAL-VIDEO.md §4): YuNet over
// the whole photo, a second look at each box, and MediaPipe's Face Landmarker
// for the blink score. Loaded on first use only — onnxruntime's WASM is
// ~14 MB, MediaPipe's ~13 MB — and from our own origin: onnxruntime's is a
// hashed static asset of the build (the bundle asks for it by
// `new URL(…, import.meta.url)`, which Turbopack emits), MediaPipe's is copied
// on install (scripts/copy-mediapipe.mjs). The model is committed in
// public/vendor/yunet/ — OpenCV Zoo, MIT, sha256 ebafce4e…22f0f0.
//
// It runs on the main thread, one photo at a time with a yield between them:
// well under a second per photo on a laptop, a dozen photos per video, the
// result stored. A worker would keep even that off the page; it is the next
// step if it shows (§9.5).

import { attachBlinks, FACES_MODEL, MAX_FACES, type PhotoFaces } from "@/lib/social-video/faces";
import {
  CHECK_SIZE,
  checkWindow,
  confirmed,
  decodeOutputs,
  inputFor,
  mapCandidate,
  suppress,
  toBgrPlanar,
  toFace,
  type Candidate,
} from "@/lib/social-video/yunet";

/** Must match package.json — the WASM is served from a path with it. */
export const MEDIAPIPE_VERSION = "1.1.1";

const MEDIAPIPE_WASM = `/vendor/mediapipe/${MEDIAPIPE_VERSION}/wasm`;
const LANDMARKER_MODEL = "/vendor/mediapipe/models/face_landmarker.task";
const YUNET_MODEL = "/vendor/yunet/face_detection_yunet_2026may.onnx";

/** The second look keeps anything the model sees at all; `confirmed` decides. */
const CHECK_FLOOR = 0.3;

/** Faces the landmarker looks for at most — enough for any photo whose blink
 * matters (a portrait, a couple, a small group). */
const LANDMARKER_FACES = 12;

export interface FaceFinder {
  /** The faces in a decoded photo, ready to store. */
  find(image: ImageBitmap): Promise<PhotoFaces>;
  close(): void;
}

export async function createFaceFinder(): Promise<FaceFinder> {
  const [ort, vision] = await Promise.all([
    import("onnxruntime-web/wasm"),
    import("@mediapipe/tasks-vision"),
  ]);
  // Threads need a cross-origin-isolated page, which the admin is not.
  ort.env.wasm.numThreads = 1;
  const session = await ort.InferenceSession.create(YUNET_MODEL, {
    executionProviders: ["wasm"],
  });
  const fileset = await vision.FilesetResolver.forVisionTasks(MEDIAPIPE_WASM);
  const landmarker = await vision.FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: LANDMARKER_MODEL },
    runningMode: "IMAGE",
    numFaces: LANDMARKER_FACES,
    outputFaceBlendshapes: true,
  });
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("NO_CANVAS");
  ctx.imageSmoothingQuality = "high";

  /** `source`'s window `from` drawn into a `width`×`height` input (black
   * around it), run through YuNet; boxes in the input's pixels. */
  async function detect(
    source: ImageBitmap,
    from: { x: number; y: number; w: number; h: number },
    to: { drawWidth: number; drawHeight: number; width: number; height: number },
    minScore?: number,
  ): Promise<Candidate[]> {
    canvas.width = to.width;
    canvas.height = to.height;
    ctx!.fillStyle = "#000";
    ctx!.fillRect(0, 0, to.width, to.height);
    ctx!.drawImage(source, from.x, from.y, from.w, from.h, 0, 0, to.drawWidth, to.drawHeight);
    const pixels = ctx!.getImageData(0, 0, to.width, to.height).data;
    const input = new ort.Tensor("float32", toBgrPlanar(pixels, to.width, to.height), [
      1,
      3,
      to.height,
      to.width,
    ]);
    const outputs = await session.run({ [session.inputNames[0]!]: input });
    return decodeOutputs(outputs, to.width, to.height, minScore);
  }

  return {
    async find(image) {
      const { width, height } = image;
      const whole = inputFor(width, height);
      const candidates = suppress(
        (await detect(image, { x: 0, y: 0, w: width, h: height }, whole)).map((c) =>
          mapCandidate(c, 1 / whole.scale),
        ),
      );

      const kept: Candidate[] = [];
      const square = {
        drawWidth: CHECK_SIZE,
        drawHeight: CHECK_SIZE,
        width: CHECK_SIZE,
        height: CHECK_SIZE,
      };
      for (const c of candidates) {
        const win = checkWindow(c);
        const check = (await detect(image, win, square, CHECK_FLOOR)).map((d) =>
          mapCandidate(d, win.w / CHECK_SIZE, win.x, win.y),
        );
        if (confirmed(c, check)) kept.push(c);
      }
      // Best first (suppress sorts), so the cap drops the least sure.
      const faces = kept.slice(0, MAX_FACES).map((c) => toFace(c, width, height));

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
      void session.release();
      landmarker.close();
    },
  };
}
