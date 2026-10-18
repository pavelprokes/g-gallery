// YuNet face detection, the pure half (docs/SOCIAL-VIDEO.md §4): the input
// tensor, decoding the model's raw outputs into boxes, and the second look
// that confirms each box. The model runs in face-finder.ts; nothing here touches
// onnxruntime, so all of it is unit-tested.
//
// Model: OpenCV Zoo's face_detection_yunet_2026may.onnx (MIT). One pass over
// the whole photo, any size: input [1, 3, H, W], BGR 0–255, H and W multiples
// of 32. Per stride 8/16/32 it returns `cls_*`, `obj_*` (one value per
// anchor), `bbox_*` (4) and `kps_*` (10: right eye, left eye, nose, the mouth's
// right and left corner — the subject's sides).

import { iou, type Face } from "@/lib/social-video/faces";

const STRIDES = [8, 16, 32] as const;

/** The input's long edge at most. On a real wedding (§7) 2048 px found a face
 * on the same photos as the full ~3000 px source, a few of 80 faces fewer in
 * a big group, in half the time — ~1 s a photo in the browser's single
 * WASM thread, and a gallery is 400 photos. */
export const MAX_EDGE = 2048;

/** A box below this score is not a candidate at all. */
export const MIN_SCORE = 0.6;

/** The second look: the box's surroundings, `CHECK_CONTEXT` times its longer
 * side, scaled to `CHECK_SIZE` and run through the model again. A face is
 * found again; a basket's weave, hands on a steering wheel or a painting on
 * an altar mostly are not (§7). */
export const CHECK_SIZE = 320;
export const CHECK_CONTEXT = 3;
/** The score the box must reach on the second look. */
export const CHECK_MIN_SCORE = 0.6;
/** How much a second-look box must overlap the first to be the same face. */
const CHECK_IOU = 0.4;

/** Two candidates overlapping more than this are the same face. */
const NMS_IOU = 0.3;

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A detection in the input's pixels, with the two eyes as YuNet reports them. */
export interface Candidate extends Box {
  score: number;
  eyes: readonly [readonly [number, number], readonly [number, number]];
}

/** The model's outputs by name, as onnxruntime returns them. */
export type Outputs = Readonly<Record<string, { readonly data: unknown }>>;

/** The size to draw a photo at for the model: the long edge capped at
 * `maxEdge`, padded with black to multiples of 32. */
export function inputFor(width: number, height: number, maxEdge = MAX_EDGE) {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  const drawWidth = Math.max(1, Math.round(width * scale));
  const drawHeight = Math.max(1, Math.round(height * scale));
  return {
    scale,
    drawWidth,
    drawHeight,
    width: Math.ceil(drawWidth / 32) * 32,
    height: Math.ceil(drawHeight / 32) * 32,
  };
}

/** Canvas RGBA pixels → the model's planar BGR. */
export function toBgrPlanar(rgba: ArrayLike<number>, width: number, height: number): Float32Array {
  const plane = width * height;
  const out = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    out[i] = rgba[i * 4 + 2]!;
    out[plane + i] = rgba[i * 4 + 1]!;
    out[2 * plane + i] = rgba[i * 4]!;
  }
  return out;
}

/** Every anchor scoring at least `minScore`, in the input's pixels. */
export function decodeOutputs(
  outputs: Outputs,
  width: number,
  height: number,
  minScore = MIN_SCORE,
): Candidate[] {
  const found: Candidate[] = [];
  for (const stride of STRIDES) {
    const cls = numbers(outputs, `cls_${stride}`);
    const obj = numbers(outputs, `obj_${stride}`);
    const bbox = numbers(outputs, `bbox_${stride}`);
    const kps = numbers(outputs, `kps_${stride}`);
    const cols = width / stride;
    const anchors = cols * (height / stride);
    for (let i = 0; i < anchors; i++) {
      const score = Math.sqrt(clamp01(cls[i]!) * clamp01(obj[i]!));
      if (!(score >= minScore)) continue;
      const col = i % cols;
      const row = Math.floor(i / cols);
      const cx = (col + bbox[i * 4]!) * stride;
      const cy = (row + bbox[i * 4 + 1]!) * stride;
      const w = Math.exp(bbox[i * 4 + 2]!) * stride;
      const h = Math.exp(bbox[i * 4 + 3]!) * stride;
      const point = (n: number): [number, number] => [
        (col + kps[i * 10 + 2 * n]!) * stride,
        (row + kps[i * 10 + 2 * n + 1]!) * stride,
      ];
      found.push({ x: cx - w / 2, y: cy - h / 2, w, h, score, eyes: [point(0), point(1)] });
    }
  }
  return found;
}

/** The best-scored box of each overlapping cluster (non-max suppression). */
export function suppress<T extends Box & { score: number }>(candidates: readonly T[]): T[] {
  const kept: T[] = [];
  for (const c of [...candidates].sort((p, q) => q.score - p.score)) {
    if (kept.every((k) => iou(k, c) < NMS_IOU)) kept.push(c);
  }
  return kept;
}

/** Scales a candidate by `k` and moves it by (dx, dy) — from one image's
 * pixels into another's. */
export function mapCandidate(c: Candidate, k: number, dx = 0, dy = 0): Candidate {
  const at = ([x, y]: readonly [number, number]): [number, number] => [dx + x * k, dy + y * k];
  return {
    x: dx + c.x * k,
    y: dy + c.y * k,
    w: c.w * k,
    h: c.h * k,
    score: c.score,
    eyes: [at(c.eyes[0]), at(c.eyes[1])],
  };
}

/** The square the second look sees, centred on the box; it may reach past
 * the photo's edge (drawn black there). */
export function checkWindow(box: Box): Box {
  const side = Math.max(box.w, box.h) * CHECK_CONTEXT;
  return { x: box.x + box.w / 2 - side / 2, y: box.y + box.h / 2 - side / 2, w: side, h: side };
}

/** Whether the second look — its detections mapped back into the photo —
 * found the same face again. */
export function confirmed(box: Box, check: readonly Candidate[]): boolean {
  return check.some((c) => c.score >= CHECK_MIN_SCORE && iou(c, box) > CHECK_IOU);
}

/** A candidate in the photo's pixels → the stored face (0–1, eyes left to right). */
export function toFace(c: Candidate, width: number, height: number): Face {
  const x = clamp01(c.x / width);
  const y = clamp01(c.y / height);
  const [a, b] = c.eyes.map(
    ([px, py]) => [clamp01(px / width), clamp01(py / height)] as [number, number],
  );
  return {
    x,
    y,
    w: Math.min(1 - x, Math.max(0, (c.x + c.w) / width - x)),
    h: Math.min(1 - y, Math.max(0, (c.y + c.h) / height - y)),
    score: clamp01(c.score),
    le: a![0] <= b![0] ? a! : b!,
    re: a![0] <= b![0] ? b! : a!,
    blink: null,
  };
}

function numbers(outputs: Outputs, name: string): ArrayLike<number> {
  const data = outputs[name]?.data;
  if (!(data instanceof Float32Array)) throw new Error(`YUNET_OUTPUT_${name}`);
  return data;
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}
