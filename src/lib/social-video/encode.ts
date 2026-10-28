"use client";

// Frames to an MP4 in the admin's browser (docs/SOCIAL-VIDEO.md §6): a canvas
// fed to WebCodecs through Mediabunny, one frame at a time, so the file is
// exactly what `drawFrame` paints — never faster than the machine can encode,
// never a dropped frame.

import {
  AudioBufferSource,
  BufferTarget,
  CanvasSource,
  canEncodeAudio,
  canEncodeVideo,
  Mp4OutputFormat,
  Output,
} from "mediabunny";
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

/** AAC at a music bitrate — what Instagram and Facebook keep. */
const AUDIO_BITRATE = 192_000;

/** FFmpeg's AAC encoder opens with one frame of silence it does not signal:
 * Mediabunny writes no edit list for it, so every player starts the sound
 * this many samples late (measured: 21.3 ms at 48 kHz, docs/REELS.md §5). */
const WASM_AAC_PRIMING = 1024;

let aacRegistered: Promise<number> | null = null;

/** AAC from the browser's own encoder where it has one, else Mediabunny's
 * WASM build of FFmpeg's, loaded only then (docs/REELS.md §5). Resolves to
 * the samples of the sound to skip so it lands in time. */
function ensureAac(channels: number, sampleRate: number): Promise<number> {
  aacRegistered ??= (async () => {
    const native = await canEncodeAudio("aac", {
      numberOfChannels: channels,
      sampleRate,
      bitrate: AUDIO_BITRATE,
    });
    if (native) return 0;
    const { registerAacEncoder } = await import("@mediabunny/aac-encoder");
    registerAacEncoder();
    return WASM_AAC_PRIMING;
  })();
  aacRegistered.catch(() => (aacRegistered = null));
  return aacRegistered;
}

export interface EncodeOptions {
  width: number;
  height: number;
  duration: number;
  codec: EncodeCodec;
  /** Paints the frame at `t` — after making sure its photos are decoded. */
  drawAt(ctx: CanvasRenderingContext2D, t: number): Promise<void>;
  /** The sound, from 0 s — a reel's music (docs/REELS.md). Silent without it. */
  audio?: AudioBuffer;
  /** 0–1, a few times a second. */
  onProgress?(share: number): void;
  signal?: AbortSignal;
}

export async function encodeVideo({
  width,
  height,
  duration,
  codec,
  audio,
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
  let sound: AudioBufferSource | null = null;
  let skip = 0;
  if (audio) {
    skip = await ensureAac(audio.numberOfChannels, audio.sampleRate);
    sound = new AudioBufferSource({ codec: "aac", bitrate: AUDIO_BITRATE });
    output.addAudioTrack(sound);
  }
  await output.start();

  const frames = Math.round(duration * FPS);
  try {
    for (let f = 0; f < frames; f++) {
      signal?.throwIfAborted();
      const t = f / FPS;
      // The sound a second at a time, ahead of that second's frames: the
      // muxer interleaves the tracks, and neither waits long on the other.
      const from = Math.round(t * (audio?.sampleRate ?? 0)) + skip;
      if (audio && sound && f % FPS === 0 && from < audio.length) {
        await sound.add(audioSecond(audio, from));
      }
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

/** One second of `audio` from sample `start` (less at the end). */
function audioSecond(audio: AudioBuffer, start: number): AudioBuffer {
  const length = Math.min(audio.sampleRate, audio.length - start);
  const chunk = new AudioBuffer({
    length,
    numberOfChannels: audio.numberOfChannels,
    sampleRate: audio.sampleRate,
  });
  for (let c = 0; c < audio.numberOfChannels; c++) {
    chunk.copyToChannel(audio.getChannelData(c).subarray(start, start + length), c);
  }
  return chunk;
}
