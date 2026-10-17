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
 * Pure and dependency-free: imported by Route Handlers, the uploader and the
 * gallery view alike.
 */

/**
 * Cloudflare caches nothing over 512 MB on our plan, and "requesting a small
 * range does not bypass this limit" — an uncached video is served from R2
 * range by range for every viewer. A web export (1080p H.264, 8–10 Mbit/s)
 * of a few minutes is a fraction of this.
 */
export const VIDEO_MAX_BYTES = 500 * 1024 * 1024;

/** The poster is a JPEG the uploading browser draws from the video. */
export const POSTER_CONTENT_TYPE = "image/jpeg";
export const POSTER_EXTENSION = ".jpg";

function stemOf(objectKey: string): string {
  const dot = objectKey.lastIndexOf(".");
  return dot > objectKey.lastIndexOf("/") ? objectKey.slice(0, dot) : objectKey;
}

/**
 * The MP4 beside a poster. Derived on the server, never accepted from the
 * client — a client-named key is a client-chosen write location — and on the
 * same stem as the poster, which is what keeps it alive through the orphan
 * sweep (src/lib/reconcile.ts spares every key whose stem a live row owns).
 */
export function videoKeyFor(posterKey: string): string {
  return `${stemOf(posterKey)}.mp4`;
}

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
