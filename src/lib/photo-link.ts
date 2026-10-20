/**
 * The open photo's place in the gallery's address — `?foto=<photo id>` — so
 * the address bar is always a link to the photo on screen and can be sent on
 * (docs/PHOTO-LINKS.md). Only a photo id: access still resolves by the share
 * token in the path, and a photo id grants nothing on its own.
 */
export const PHOTO_PARAM = "foto";

const PHOTO_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** A value that can be a photo id — a repeated parameter (an array) cannot. */
export function isPhotoId(value: unknown): value is string {
  return typeof value === "string" && PHOTO_ID.test(value);
}

/** The photo a URL's query names, or null when it names none (or garbage). */
export function photoParam(search: string): string | null {
  const id = new URLSearchParams(search).get(PHOTO_PARAM);
  return isPhotoId(id) ? id : null;
}

/**
 * The same address pointing at `photoId`, or at no photo for null. Every other
 * query parameter and the hash (a chapter anchor) are kept as they were.
 */
export function withPhotoParam(href: string, photoId: string | null): string {
  const url = new URL(href);
  if (photoId) url.searchParams.set(PHOTO_PARAM, photoId);
  else url.searchParams.delete(PHOTO_PARAM);
  return `${url.pathname}${url.search}${url.hash}`;
}
