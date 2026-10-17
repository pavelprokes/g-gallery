"use client";

import { crc32HexOfBlob } from "@/lib/crc32";
import { inspectMp4, isH264, type Mp4Facts } from "@/lib/mp4-inspect";
import { averageColorOf } from "@/lib/placeholder";
import { POSTER_CONTENT_TYPE } from "@/lib/video";
import { withTimeout } from "@/lib/with-timeout";

/**
 * The browser half of a video upload (docs/VIDEO.md) — the counterpart of
 * `prepareUpload` for photos, and on the main thread because it needs a
 * `<video>` element to decode the poster frame.
 *
 * Nothing is transcoded: the photographer exports a web-ready MP4 and it is
 * stored byte for byte. What happens here is checking that it is one, and
 * drawing the poster every image surface will show in its place.
 */
export interface PreparedVideo {
  /** JPEG of one frame — stored as the row's `objectKey`. */
  poster: Blob;
  /** CRC32 of the MP4, for the streaming ZIP writer. */
  crc32: string;
  takenAt: Date | null;
  width: number;
  height: number;
  durationMs: number;
  placeholder: string | null;
}

/** Why a picked MP4 cannot go up — each one has its own sentence in the uploader. */
export type VideoProblem = "video_location" | "video_codec";

export class VideoNotUsable extends Error {
  constructor(readonly reason: VideoProblem) {
    super(reason);
    this.name = "VideoNotUsable";
  }
}

/**
 * A quarter of the way in: the first frame of an edited film is a fade from
 * black far more often than not, and the photographer has no other way to
 * choose (yet — docs/VIDEO.md).
 */
const POSTER_AT = 0.25;
/** Long edge; a 4K export keeps its full width, nothing bigger is useful. */
const POSTER_MAX_PX = 3840;
const POSTER_QUALITY = 0.9;
/** Decoding a frame takes well under a second; this is for a decoder that never answers. */
const FRAME_TIMEOUT_MS = 30_000;

/**
 * What is wrong with this MP4, read from its header alone — cheap enough to
 * run on every picked video before anything is signed.
 */
export async function videoProblem(file: File): Promise<VideoProblem | null> {
  return problemIn(await inspectMp4(file));
}

function problemIn(facts: Mp4Facts | null): VideoProblem | null {
  // Invariant 2: no location leaves the browser. A photo's GPS is stripped in
  // place; a video is refused instead — an export from an editor never has
  // it, a clip off a phone does, and re-exporting is the honest fix.
  if (facts?.hasLocation) return "video_location";
  // Only H.264 plays everywhere. Checked on the file, not by whether *this*
  // browser decodes it: Safari decodes HEVC and would let through a video
  // that Chrome on Windows then cannot play.
  if (facts && facts.videoCodec !== null && !isH264(facts.videoCodec)) return "video_codec";
  return null;
}

export async function prepareVideoUpload(file: File): Promise<PreparedVideo> {
  const facts = await inspectMp4(file);
  const problem = problemIn(facts);
  if (problem) throw new VideoNotUsable(problem);

  const frame = await posterFrame(file);
  const [crc32, placeholder] = await Promise.all([
    crc32HexOfBlob(file),
    averageColorOf(frame.poster),
  ]);

  return {
    ...frame,
    crc32,
    placeholder,
    // The container's own creation time, else the file's mtime — the same
    // order of preference as a photo's EXIF. An editor's export usually
    // stamps the render time, which is why a delivered gallery is ordered by
    // file name (docs/PHOTO-ORDER.md) and a video placed by naming it.
    takenAt:
      facts?.createdAt ??
      (Number.isFinite(file.lastModified) && file.lastModified > 0
        ? new Date(file.lastModified)
        : null),
  };
}

async function posterFrame(
  file: File,
): Promise<Pick<PreparedVideo, "poster" | "width" | "height" | "durationMs">> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  // Muted + inline is what lets WebKit load and seek without a user gesture.
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = url;

  try {
    await withTimeout(once(video, "loadedmetadata"), FRAME_TIMEOUT_MS, "video metadata");
    if (!video.videoWidth || !video.videoHeight || !Number.isFinite(video.duration)) {
      throw new VideoNotUsable("video_codec");
    }

    video.currentTime = Math.min(video.duration * POSTER_AT, Math.max(0, video.duration - 0.1));
    await withTimeout(once(video, "seeked"), FRAME_TIMEOUT_MS, "video seek");
    // HAVE_CURRENT_DATA: a frame is there to draw. Some engines report the
    // seek before decoding it.
    if (video.readyState < 2) {
      await withTimeout(once(video, "loadeddata"), FRAME_TIMEOUT_MS, "video frame");
    }

    const scale = Math.min(1, POSTER_MAX_PX / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const context = canvas.getContext("2d");
    if (!context) throw new VideoNotUsable("video_codec");
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    const poster = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, POSTER_CONTENT_TYPE, POSTER_QUALITY),
    );
    if (!poster) throw new VideoNotUsable("video_codec");

    return {
      poster,
      width: video.videoWidth,
      height: video.videoHeight,
      durationMs: Math.round(video.duration * 1000),
    };
  } catch (error) {
    // A decoder that cannot open the file, or never answers, means this is
    // not a video we can show — say so rather than "upload failed".
    if (error instanceof VideoNotUsable) throw error;
    throw new VideoNotUsable("video_codec");
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

function once(target: HTMLVideoElement, event: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = () => {
      target.removeEventListener(event, done);
      target.removeEventListener("error", failed);
      resolve();
    };
    const failed = () => {
      target.removeEventListener(event, done);
      target.removeEventListener("error", failed);
      reject(new VideoNotUsable("video_codec"));
    };
    target.addEventListener(event, done);
    target.addEventListener("error", failed);
  });
}
