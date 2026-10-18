"use client";

// Frames to an MP4 in the admin's browser (docs/SOCIAL-VIDEO.md §6): a canvas
// fed to WebCodecs through Mediabunny, one frame at a time, so the file is
// exactly what `drawFrame` paints — never faster than the machine can encode,
// never a dropped frame.

import { BufferTarget, CanvasSource, canEncodeVideo, Mp4OutputFormat, Output } from "mediabunny";
import { FPS } from "@/lib/social-video/timeline";

/** H.264 where the browser can encode it — the only codec the gallery takes
 * (docs/VIDEO.md) — VP9 in MP4 otherwise, which Instagram still accepts. */
export type EncodeCodec = "avc" | "vp9";

/** Instagram re-encodes anyway; this keeps the upload clean, not small. */
const BITRATE = 10_000_000;

/** The codec this browser encodes at this size; null without WebCodecs. */
export async function chooseCodec(width: number, height: number): Promise<EncodeCodec | null> {
  if (typeof VideoEncoder === "undefined") return null;
  for (const codec of ["avc", "vp9"] as const) {
    if (await canEncodeVideo(codec, { width, height, bitrate: BITRATE })) return codec;
  }
  return null;
}

export interface EncodeOptions {
  width: number;
  height: number;
  duration: number;
  codec: EncodeCodec;
  /** Paints the frame at `t` — after making sure its photos are decoded. */
  drawAt(ctx: CanvasRenderingContext2D, t: number): Promise<void>;
  /** 0–1, a few times a second. */
  onProgress?(share: number): void;
  signal?: AbortSignal;
}

export async function encodeVideo({
  width,
  height,
  duration,
  codec,
  drawAt,
  onProgress,
  signal,
}: EncodeOptions): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("NO_CANVAS");

  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target });
  // A keyframe every second: cheap at this bitrate, and a social app's
  // scrubber lands on a clean frame.
  const source = new CanvasSource(canvas, { codec, bitrate: BITRATE, keyFrameInterval: 1 });
  output.addVideoTrack(source, { frameRate: FPS });
  await output.start();

  const frames = Math.round(duration * FPS);
  try {
    for (let f = 0; f < frames; f++) {
      signal?.throwIfAborted();
      const t = f / FPS;
      await drawAt(ctx, t);
      await source.add(t, 1 / FPS);
      if (f % FPS === 0) onProgress?.(f / frames);
    }
    await output.finalize();
  } catch (error) {
    await output.cancel();
    throw error;
  }
  onProgress?.(1);
  if (!target.buffer) throw new Error("EMPTY_OUTPUT");
  return new Blob([target.buffer], { type: "video/mp4" });
}
