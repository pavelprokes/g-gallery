/**
 * The photographer's videos in a gallery (docs/VIDEO.md).
 *
 * A video is a `Photo` row whose `objectKey` is its **poster frame** and whose
 * `videoObjectKey` is the MP4 beside it, sharing the same stem. Every surface
 * that only knows `objectKey` — the grid's image, the cover, the link preview,
 * offline, the orphan sweep — therefore keeps working and shows the poster.
 * Forgetting about video somewhere degrades to a still image, never to a
 * broken one. What has to know is listed in docs/VIDEO.md and reads from here.
 *
 * Pure: imported by Route Handlers, the uploader and the gallery view alike.
 */

import { objectStem } from "@/lib/thumbnail";

/**
 * The limit is resolution, not size (Pavel, 2026-10-17): a long film at a
 * good bitrate must not be refused for being long. 4K on the long edge —
 * portrait or landscape, UHD 3840 and cinema 4096 alike — is the most any
 * screen a guest owns can show, and the top of H.264's level 5.1 that phones
 * decode in hardware.
 */
export const VIDEO_MAX_LONG_EDGE_PX = 4096;

/**
 * Not a policy, a ceiling: `Photo.sizeBytes` is a Postgres `int4`, so 2 GiB
 * minus one byte is the most a row can record — about 6 minutes of 4K at
 * 45 Mbit/s, 30 of 1080p at 9. Past Cloudflare's 512 MB cache limit a video
 * still plays (served from R2 range by range, egress-free), it is just not
 * held at the edge.
 *
 * ponytail: int4 ceiling; widening `sizeBytes` to BigInt lifts it to R2's
 * 4.995 GiB single-PUT limit, at the cost of every reader handling a bigint.
 */
export const VIDEO_MAX_BYTES = 2 ** 31 - 1;

/** How long the MP4's presigned PUT stays valid — six hours, against R2's seven-day maximum. */
export const VIDEO_PUT_EXPIRY_SECONDS = 6 * 60 * 60;

/** True when a video's coded size fits `VIDEO_MAX_LONG_EDGE_PX`. */
export function withinVideoResolution(width: number, height: number): boolean {
  return Math.max(width, height) <= VIDEO_MAX_LONG_EDGE_PX;
}

/** The poster is a JPEG the uploading browser draws from the video. */
export const POSTER_CONTENT_TYPE = "image/jpeg";
export const POSTER_EXTENSION = ".jpg";

/**
 * The MP4 beside a poster. Derived on the server, never accepted from the
 * client — a client-named key is a client-chosen write location — and on the
 * same stem as the poster, which is what keeps it alive through the orphan
 * sweep (src/lib/reconcile.ts spares every key whose stem a live row owns).
 */
export function videoKeyFor(posterKey: string): string {
  return `${objectStem(posterKey)}.mp4`;
}

/**
 * The muted loop beside a poster, on the poster's stem — so the orphan sweep
 * keeps it exactly as long as that poster is the row's `objectKey`, the way it
 * keeps a thumbnail (src/lib/reconcile.ts `classifyKey`).
 */
export function loopKeyFor(posterKey: string): string {
  return `${objectStem(posterKey)}${LOOP_SUFFIX}`;
}

export const LOOP_SUFFIX = ".loop.mp4";

/** What the loop is recorded as: long enough to read as "this moves", short enough to stay ~2 MB. */
export const LOOP_SECONDS = 4;
export const LOOP_MAX_PX = 1280;
export const LOOP_BITS_PER_SECOND = 3_000_000;

/**
 * The object a download delivers: the MP4 for a video, the photo otherwise.
 * The one place the ZIP manifests and the single-file download pick a key —
 * forgetting it would zip the poster in place of the film, silently.
 */
export function downloadKeyOf(photo: { objectKey: string; videoObjectKey: string | null }): string {
  return photo.videoObjectKey ?? photo.objectKey;
}

/** The columns a gallery page needs to render a video; spread into a `select`. */
export const VIDEO_SELECT = { videoObjectKey: true, durationMs: true } as const;

/** What the gallery view gets: null for a photo. */
export interface GalleryVideo {
  key: string;
  durationMs: number | null;
}

export function videoOf(photo: {
  videoObjectKey: string | null;
  durationMs: number | null;
}): GalleryVideo | null {
  return photo.videoObjectKey ? { key: photo.videoObjectKey, durationMs: photo.durationMs } : null;
}

/**
 * "120 photos", "2 videos", or both — a gallery's size as a guest reads it.
 * A video is a photo row, so `total` includes `videos`; a gallery of films
 * must not announce itself as "1 photo". Empty when there is nothing.
 */
export function mediaCounts(
  t: (key: "photoCount" | "videoCount", values: { count: number }) => string,
  total: number,
  videos: number,
): string[] {
  const photos = total - videos;
  return [
    photos > 0 ? t("photoCount", { count: photos }) : null,
    videos > 0 ? t("videoCount", { count: videos }) : null,
  ].filter((part): part is string => part !== null);
}

/** "0:42", "2:49", "1:02:03" — the badge on a video tile. */
export function formatDuration(ms: number): string {
  // Floored, as every player's own clock is — the badge must not say 2:50
  // over a player that ends at 2:49.
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`
    : `${minutes}:${seconds}`;
}

/**
 * Where the browser fetches the MP4: straight from the bucket's public host,
 * never through Vercel (invariant 1), with HTTP Range so seeking works.
 *
 * `NEXT_PUBLIC_MEDIA_BASE_URL` when set, otherwise the image host — which in
 * production *is* the bucket's custom domain. Locally the image host is
 * imgproxy, which cannot serve an MP4, so without the variable there is no
 * URL and the lightbox shows the poster alone.
 */
export function videoSrc(key: string): string | null {
  const media = process.env.NEXT_PUBLIC_MEDIA_BASE_URL;
  const base =
    media ||
    (process.env.NEXT_PUBLIC_IMAGE_TRANSFORM === "imgproxy"
      ? undefined
      : process.env.NEXT_PUBLIC_PHOTOS_BASE_URL);
  if (!base) return null;
  return `${base.replace(/\/$/, "")}/${key.split("/").map(encodeURIComponent).join("/")}`;
}
