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
 * The limit is resolution, not size (Pavel, 2026-10-17): a long film at a
 * good bitrate must not be refused for being long. 4K on the long edge —
 * portrait or landscape, UHD 3840 and cinema 4096 alike — is the most any
 * screen a guest owns can show, and the top of H.264's level 5.1 that phones
 * decode in hardware.
 */
export const VIDEO_MAX_LONG_EDGE_PX = 4096;

/**
 * Not a policy, a ceiling: R2 takes at most 4.995 GiB in one PUT, and the
 * upload is one presigned PUT. Past Cloudflare's 512 MB cache limit a video
 * still plays — it is served from R2 range by range, egress-free — it is just
 * not held at the edge.
 */
export const VIDEO_MAX_BYTES = Math.floor(4.9 * 1024 ** 3);

/** How long the MP4's presigned PUT stays valid — six hours, against R2's seven-day maximum. */
export const VIDEO_PUT_EXPIRY_SECONDS = 6 * 60 * 60;

/** True when a video's coded size fits `VIDEO_MAX_LONG_EDGE_PX`. */
export function withinVideoResolution(width: number, height: number): boolean {
  return Math.max(width, height) <= VIDEO_MAX_LONG_EDGE_PX;
}

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
