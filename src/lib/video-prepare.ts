"use client";

import { crc32HexOfBlob } from "@/lib/crc32";
import { readMp4Meta } from "@/lib/mp4-meta";
import { averageColorOf } from "@/lib/placeholder";
import { POSTER_CONTENT_TYPE } from "@/lib/media";

/**
 * The browser half of a video upload (docs/VIDEO.md §3) — the counterpart of
 * `prepareUpload` for a photo, run on the main thread because it needs a
 * `<video>` element to decode a frame.
 *
 * The decode is the whole check: a browser that can draw a frame of the file
 * can play it, and one that cannot (HEVC in Chrome, 10-bit 4:2:2, ProRes in
 * an .mp4) produces no poster and therefore no upload. The photographer learns
 * that here, at their desk, instead of a guest learning it from a black box.
 */

/** Long edge of the poster. Lightbox-sized: the poster is what a viewer sees first. */
const POSTER_MAX_PX = 1920;
const POSTER_QUALITY = 0.85;
/** Films open on black; a tenth in is past the fade, capped so a long film needn't seek far. */
const POSTER_AT_FRACTION = 0.1;
const POSTER_AT_MAX_S = 30;
/** Metadata of a local file arrives in milliseconds; past this the decoder is not coming. */
const DECODE_TIMEOUT_MS = 15_000;

/** The file cannot be decoded here, so it would not play for viewers either. */
export class VideoNotPlayable extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "VideoNotPlayable";
  }
}

export interface PreparedVideo {
  /** The file with its location removed — the exact bytes that get stored. */
  body: Blob;
  crc32: string;
  takenAt: Date | null;
  /** Display size, rotation already applied by the browser. */
  width: number;
  height: number;
  durationMs: number;
  poster: Blob;
  placeholder: string | null;
}

export async function prepareVideo(file: File): Promise<PreparedVideo> {
  // The frame first: it is the check, and it is cheap; the CRC reads all of a
  // file that might be refused a second later.
  const frame = await posterFrame(file);
  const meta = await readMp4Meta(file);
  const crc32 = await crc32HexOfBlob(meta.body);
  const placeholder = await averageColorOf(frame.poster);
  return {
    body: meta.body,
    crc32,
    // The recording's own time where the file has one; the file's mtime is
    // the export day for a film, but it is still better than "now".
    takenAt:
      meta.takenAt ??
      (Number.isFinite(file.lastModified) && file.lastModified > 0
        ? new Date(file.lastModified)
        : null),
    width: frame.width,
    height: frame.height,
    durationMs: frame.durationMs,
    poster: frame.poster,
    placeholder,
  };
}

/**
 * Only answers "can this browser decode it" — metadata and one frame, no
 * upload, no CRC. Lets the run refuse an unplayable file before a row exists
 * for it.
 */
export async function probeVideo(file: File): Promise<boolean> {
  try {
    await withVideo(file, async () => undefined);
    return true;
  } catch {
    return false;
  }
}

async function posterFrame(
  file: File,
): Promise<{ poster: Blob; width: number; height: number; durationMs: number }> {
  return withVideo(file, async (video) => {
    const duration = video.duration;
    const durationMs = Number.isFinite(duration) ? Math.round(duration * 1000) : 0;
    const at = Number.isFinite(duration)
      ? Math.min(duration * POSTER_AT_FRACTION, POSTER_AT_MAX_S)
      : 0;
    if (at > 0) await seek(video, at);

    const width = video.videoWidth;
    const height = video.videoHeight;
    const scale = Math.min(1, POSTER_MAX_PX / Math.max(width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const context = canvas.getContext("2d");
    if (!context) throw new VideoNotPlayable("no 2d canvas");
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    const poster = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, POSTER_CONTENT_TYPE, POSTER_QUALITY),
    );
    if (!poster || poster.type !== POSTER_CONTENT_TYPE) {
      throw new VideoNotPlayable("the frame could not be encoded");
    }
    return { poster, width, height, durationMs };
  });
}

/**
 * Loads `file` into a detached, muted `<video>` until a frame is decodable,
 * hands it to `work`, and always tears it down — an object URL for a 2 GB file
 * must not outlive the upload.
 */
async function withVideo<T>(file: File, work: (video: HTMLVideoElement) => Promise<T>): Promise<T> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new VideoNotPlayable("timed out decoding")),
        DECODE_TIMEOUT_MS,
      );
      video.onloadeddata = () => {
        clearTimeout(timer);
        // An audio-only file or a codec with no video decoder still fires
        // loadeddata, with a zero-sized picture.
        if (video.videoWidth > 0 && video.videoHeight > 0) resolve();
        else reject(new VideoNotPlayable("no decodable picture"));
      };
      video.onerror = () => {
        clearTimeout(timer);
        reject(new VideoNotPlayable(video.error?.message || `media error ${video.error?.code}`));
      };
      video.src = url;
    });
    return await work(video);
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

function seek(video: HTMLVideoElement, seconds: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, DECODE_TIMEOUT_MS);
    video.onseeked = () => {
      clearTimeout(timer);
      resolve();
    };
    video.currentTime = seconds;
  });
}
