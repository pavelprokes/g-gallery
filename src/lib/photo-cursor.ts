import type { TimelinePosition } from "@/lib/gallery-chapters";
import { isPhotoOrder, isValidOrderKey, type PhotoOrder } from "@/lib/photo-order";

/**
 * Keyset pagination cursor for the gallery photo timeline.
 *
 * Opaque to the client by design (docs/AUDIT.md §2, UX doc §10–§11): it is a
 * base64url blob, not a page number, so the backend is free to change what's
 * inside without breaking a client that only ever echoes it back.
 */

/** Rows per page, both for the first server-rendered page
 * (`src/app/g/[token]/page.tsx`) and every subsequent client-fetched one
 * (`src/app/api/g/[token]/photos/route.ts`) — the two have to agree, or the
 * client's `useInfiniteQuery` would see a cursor for a page size it never
 * asked for. Sized for a handful of justified rows per fetch, not one giant
 * batch or a chatty one-row-at-a-time trickle. */
export const PHOTOS_PAGE_SIZE = 60;

/**
 * How many pages one response may bring ahead of the viewer — a photo's link
 * (src/lib/shared-gallery.ts) or a chapter's / highlight's jump (the photos
 * route): 600 photos, ~120 kB compressed. Past it the client pulls the rest.
 */
export const PAGES_AHEAD_MAX = 10;

/**
 * A place in the gallery's order (src/lib/photo-order.ts), plus the order it
 * was taken in. A gallery can be switched between orders while a guest is
 * scrolling it; a cursor from the other order would name a key of the wrong
 * kind, so it is refused rather than turned into a wrong page.
 */
export interface PhotoCursor extends TimelinePosition {
  order: PhotoOrder;
}

export function encodeCursor(cursor: PhotoCursor): string {
  const json = JSON.stringify({ o: cursor.order, key: cursor.key, id: cursor.id });
  return Buffer.from(json, "utf8").toString("base64url");
}

/** Null for anything malformed, or from a different order than `order`. */
export function decodeCursor(token: string, order: PhotoOrder): PhotoCursor | null {
  try {
    const raw = JSON.parse(Buffer.from(token, "base64url").toString("utf8")) as {
      o?: unknown;
      key?: unknown;
      takenAt?: unknown;
      id?: unknown;
    };
    if (typeof raw.id !== "string" || !raw.id) return null;
    // Cursors minted before orders existed carried `takenAt` alone — a page
    // loaded before the deploy keeps scrolling after it.
    const cursor: PhotoCursor | null =
      raw.o === undefined && typeof raw.takenAt === "string"
        ? { order: "TAKEN_AT", key: raw.takenAt, id: raw.id }
        : typeof raw.key === "string" && isPhotoOrder(raw.o)
          ? { order: raw.o, key: raw.key, id: raw.id }
          : null;
    if (!cursor || cursor.order !== order || !isValidOrderKey(order, cursor.key)) return null;
    return cursor;
  } catch {
    return null;
  }
}

/**
 * Consecutive photos in the gallery's order cut into the pages the cursor
 * would have produced one request at a time: `PHOTOS_PAGE_SIZE` each, every
 * page but the last carrying the cursor of its own last photo, the last one
 * carrying a cursor only when `hasMore` says photos follow it.
 *
 * Why not one big page: an infinite query refetches as many pages as it holds,
 * from the first page's param on (TanStack's infiniteQueryBehavior). A single
 * 343-photo first page would come back as 60 on the next invalidation, and an
 * open lightbox at photo 343 would land on another photo. Pages with the very
 * boundaries sequential fetching gives refetch into themselves
 * (docs/GALLERY-LOADING.md).
 */
export function toPages<T extends { id: string; orderKey: string }>(
  order: PhotoOrder,
  items: readonly T[],
  hasMore: boolean,
): { items: T[]; nextCursor: string | null }[] {
  const pages: { items: T[]; nextCursor: string | null }[] = [];
  for (let start = 0; start < items.length || pages.length === 0; start += PHOTOS_PAGE_SIZE) {
    const page = items.slice(start, start + PHOTOS_PAGE_SIZE);
    const last = page.at(-1);
    const more = start + PHOTOS_PAGE_SIZE < items.length || hasMore;
    pages.push({
      items: page,
      nextCursor: more && last ? encodeCursor({ order, key: last.orderKey, id: last.id }) : null,
    });
  }
  return pages;
}
