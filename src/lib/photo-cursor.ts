import type { TimelinePosition } from "@/lib/gallery-chapters";
import { isValidOrderKey, type PhotoOrder } from "@/lib/photo-order";

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
        : typeof raw.key === "string" && (raw.o === "TAKEN_AT" || raw.o === "FILE_NAME")
          ? { order: raw.o, key: raw.key, id: raw.id }
          : null;
    if (!cursor || cursor.order !== order || !isValidOrderKey(order, cursor.key)) return null;
    return cursor;
  } catch {
    return null;
  }
}
