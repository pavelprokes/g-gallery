/**
 * Photos and videos as gallery items (docs/VIDEO.md §2).
 *
 * The one rule this file exists for: **every surface that draws an item as an
 * image gets the poster of a video, never the video.** The substitution
 * happens where rows leave the database for the client, through
 * `displayKeyOf`, so the image loader, the transforms and the signed grants
 * need no video branch — and a video key can never be sent to Image
 * Transformations, which would fail and bill for the attempt.
 *
 * Client-safe: no Prisma import, so the gallery's client components can use
 * the same helpers the server does.
 */

export type MediaKind = "PHOTO" | "VIDEO";

/** Largest video the single-PUT path takes: `Photo.sizeBytes` is a 32-bit Int. */
export const MAX_VIDEO_BYTES = 2 ** 31 - 1;

/** The only container + codec the gallery plays everywhere (docs/VIDEO.md §1). */
export const VIDEO_CONTENT_TYPE = "video/mp4";

/** The poster frame's content type — always JPEG, whatever made it. */
export const POSTER_CONTENT_TYPE = "image/jpeg";

const POSTER_SUFFIX = ".poster.jpg";

function stemOf(objectKey: string): string {
  const dot = objectKey.lastIndexOf(".");
  return dot > objectKey.lastIndexOf("/") ? objectKey.slice(0, dot) : objectKey;
}

/**
 * Where a video's poster lives. Derived from the video's key, never supplied
 * by the client — a client-named key is a client-chosen write location inside
 * the gallery's prefix (the same rule as `thumbKeyFor`).
 */
export function posterKeyFor(objectKey: string): string {
  return `${stemOf(objectKey)}${POSTER_SUFFIX}`;
}

/** True for keys `posterKeyFor` produced. */
export function isPosterKey(key: string): boolean {
  return key.endsWith(POSTER_SUFFIX);
}

/** The stem a poster belongs to — what the orphan sweep keys on. */
export function posterOwnerStem(key: string): string {
  return key.slice(0, -POSTER_SUFFIX.length);
}

export interface MediaRow {
  kind: MediaKind;
  objectKey: string;
  posterObjectKey: string | null;
}

/**
 * The key an item is drawn from. A confirmed video always has a poster —
 * confirm refuses one without — so the derived fallback is only ever reached
 * by a row written outside that path, and it still names an image.
 */
export function displayKeyOf(row: MediaRow): string {
  if (row.kind !== "VIDEO") return row.objectKey;
  return row.posterObjectKey ?? posterKeyFor(row.objectKey);
}

/** What the player needs; travels beside the display key, never instead of it. */
export interface GalleryVideo {
  /** The MP4 straight from the bucket — never through the image loader. */
  url: string;
  durationMs: number | null;
  sizeBytes: number | null;
}

/**
 * The public URL a video plays from: the delivery host the image loader also
 * uses, without any `/cdn-cgi/image` transform (docs/VIDEO.md §1 — the MP4 is
 * served as uploaded, Range requests and all). Each path segment is encoded,
 * the same as the archive link.
 */
export function videoUrlFor(objectKey: string): string {
  const path = objectKey.split("/").map(encodeURIComponent).join("/");
  const base = process.env.NEXT_PUBLIC_PHOTOS_BASE_URL?.replace(/\/$/, "");
  return base ? `${base}/${path}` : `/${path}`;
}

export function galleryVideoOf(
  row: MediaRow & { durationMs: number | null; sizeBytes: number | null },
): GalleryVideo | null {
  if (row.kind !== "VIDEO") return null;
  return { url: videoUrlFor(row.objectKey), durationMs: row.durationMs, sizeBytes: row.sizeBytes };
}

/** Columns `displayKeyOf` + `galleryVideoOf` read — spread into a Prisma `select`. */
export const MEDIA_SELECT = {
  kind: true,
  objectKey: true,
  posterObjectKey: true,
  durationMs: true,
  sizeBytes: true,
} as const;

/** "1:42", "12:05", "1:02:09" — the tile's duration chip. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${ss}` : `${minutes}:${ss}`;
}

/** Whole minutes and seconds, for a label read aloud instead of "1:42". */
export function durationParts(ms: number): { minutes: number; seconds: number } {
  const total = Math.max(0, Math.round(ms / 1000));
  return { minutes: Math.floor(total / 60), seconds: total % 60 };
}
