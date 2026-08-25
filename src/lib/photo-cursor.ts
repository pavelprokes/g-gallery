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

/** Timeline position: capture time first, id as the burst tiebreaker
 * (2026-08-25 — the gallery reads oldest shot first, the day as it happened,
 * replacing the newest-upload-first ordering of 2026-08-23). */
export interface PhotoCursor {
  takenAt: Date;
  id: string;
}

export function encodeCursor(cursor: PhotoCursor): string {
  const json = JSON.stringify({ takenAt: cursor.takenAt.toISOString(), id: cursor.id });
  return Buffer.from(json, "utf8").toString("base64url");
}

export function decodeCursor(token: string): PhotoCursor | null {
  try {
    const raw = JSON.parse(Buffer.from(token, "base64url").toString("utf8")) as {
      takenAt?: unknown;
      id?: unknown;
    };
    if (typeof raw.takenAt !== "string" || typeof raw.id !== "string" || !raw.id) return null;
    const takenAt = new Date(raw.takenAt);
    if (Number.isNaN(takenAt.getTime())) return null;
    return { takenAt, id: raw.id };
  } catch {
    return null;
  }
}
