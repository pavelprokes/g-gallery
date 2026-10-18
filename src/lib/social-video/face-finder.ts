// Face detection (docs/SOCIAL-VIDEO.md §4): YuNet over the whole photo, a
// second look at each box, then for the faces that matter MediaPipe's Face
// Landmarker on the head for the blink score and the eye region's sharpness
// (the photo check, src/lib/photo-check.ts). Runs inside the face worker (face-worker.ts, driven by detect.ts), so
// it uses only what a worker has: OffscreenCanvas, no DOM.
//
// Everything is served from our own origin: onnxruntime's WASM is a hashed
// static asset of the build (the bundle asks for it by
// `new URL(…, import.meta.url)`, which Turbopack emits), MediaPipe's is copied
// on install (scripts/copy-mediapipe.mjs). The model is committed in
// public/vendor/yunet/ — OpenCV Zoo, MIT, sha256 ebafce4e…22f0f0.

import {
  centredInCrop,
  EYE_SAMPLE_HEIGHT,
  EYE_SAMPLE_WIDTH,
  eyeRegion,
  eyeSharpness,
  facesToAnalyse,
  headRegion,
  type Rect,
} from "@/lib/photo-check";
import { FACES_MODEL, MAX_FACES, type Face, type PhotoFaces } from "@/lib/social-video/faces";
import {
  CHECK_MIN_SCORE,
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

/** The head is drawn this large for the landmarker — its own input is 192 px. */
const HEAD_SIZE = 256;

export interface FaceFinderCore {
  /** The faces in a decoded photo, ready to store. */
  find(image: ImageBitmap): Promise<PhotoFaces>;
}

export async function createFaceFinderCore(): Promise<FaceFinderCore> {
  const [ort, vision] = await Promise.all([
    import("onnxruntime-web/wasm"),
    import("@mediapipe/tasks-vision"),
  ]);
  // Threads need a cross-origin-isolated page, which the admin is not.
  ort.env.wasm.numThreads = 1;
  const session = await ort.InferenceSession.create(YUNET_MODEL, {
    executionProviders: ["wasm"],
  });
  // The blink score is a refinement: without it the faces are still found.
  const landmarker = await vision.FilesetResolver
    // The classic build: Turbopack's worker is a classic one (detect.ts).
    .forVisionTasks(MEDIAPIPE_WASM)
    .then((fileset) =>
      vision.FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: LANDMARKER_MODEL },
        runningMode: "IMAGE",
        // One head at a time, cut out around a face YuNet found: on the whole
        // photo the landmarker misses most faces smaller than a portrait's.
        numFaces: 1,
        outputFaceBlendshapes: true,
      }),
    )
    .catch((cause: unknown) => {
      console.warn("[g-gallery/social-video] blink detection unavailable", cause);
      return null;
    });
  const canvas = new OffscreenCanvas(1, 1);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("NO_CANVAS");

  /** `source`'s window `from` drawn into a `width`×`height` input (black
   * around it), run through YuNet; boxes in the input's pixels. */
  async function detect(
    source: ImageBitmap,
    from: { x: number; y: number; w: number; h: number },
    to: { drawWidth: number; drawHeight: number; width: number; height: number },
    minScore?: number,
  ): Promise<Candidate[]> {
    // Resizing resets the context's state, smoothing included.
    canvas.width = to.width;
    canvas.height = to.height;
    ctx!.imageSmoothingEnabled = true;
    ctx!.imageSmoothingQuality = "high";
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

  /** `source`'s `region` drawn into a `width`×`height` canvas (black where it
   * leaves the photo); nearest pixel when `nearest`. */
  function sample(
    source: ImageBitmap,
    region: Rect,
    width: number,
    height: number,
    nearest: boolean,
  ) {
    canvas.width = width;
    canvas.height = height;
    ctx!.imageSmoothingEnabled = !nearest;
    ctx!.imageSmoothingQuality = "high";
    ctx!.fillStyle = "#000";
    ctx!.fillRect(0, 0, width, height);
    ctx!.drawImage(source, region.x, region.y, region.w, region.h, 0, 0, width, height);
    return ctx!.getImageData(0, 0, width, height);
  }

  /** Both eyes' blink on the head cut out around `face`; null without a landmarker or a face. */
  function blinkOf(image: ImageBitmap, face: Face): number | null {
    if (!landmarker) return null;
    const head = sample(
      image,
      headRegion(face, image.width, image.height),
      HEAD_SIZE,
      HEAD_SIZE,
      false,
    );
    const marked = landmarker.detect(head);
    // The crop can hold a neighbour's face too (a couple cheek to cheek, a
    // tight row); its blink must not land on this face.
    if (!centredInCrop(marked.faceLandmarks[0] ?? [])) return null;
    const shapes = marked.faceBlendshapes[0]?.categories ?? [];
    const score = (name: string) => shapes.find((c) => c.categoryName === name)?.score;
    const left = score("eyeBlinkLeft");
    const right = score("eyeBlinkRight");
    return left === undefined || right === undefined ? null : round3(Math.min(left, right));
  }

  function sharpnessOf(image: ImageBitmap, face: Face): number | null {
    const region = eyeRegion(face, image.width, image.height);
    if (!region) return null;
    const pixels = sample(image, region, EYE_SAMPLE_WIDTH, EYE_SAMPLE_HEIGHT, true);
    const sharp = eyeSharpness(pixels.data, EYE_SAMPLE_WIDTH, EYE_SAMPLE_HEIGHT);
    return sharp === null ? null : round3(sharp);
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
        const check = (await detect(image, win, square, CHECK_MIN_SCORE)).map((d) =>
          mapCandidate(d, win.w / CHECK_SIZE, win.x, win.y),
        );
        if (confirmed(c, check)) kept.push(c);
      }
      // Best first (suppress sorts), so the cap drops the least sure.
      const faces = kept.slice(0, MAX_FACES).map((c) => toFace(c, width, height));

      const looked = new Set(facesToAnalyse(faces));
      return {
        v: 1,
        model: FACES_MODEL,
        faces: faces.map((face) =>
          looked.has(face)
            ? { ...face, blink: blinkOf(image, face), sharp: sharpnessOf(image, face) }
            : face,
        ),
      };
    },
  };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
