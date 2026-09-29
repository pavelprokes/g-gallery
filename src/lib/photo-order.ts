import type { Prisma } from "@/generated/prisma/client";
import type { PhotoOrder } from "@/generated/prisma/enums";
import { compareTimeline, type TimelinePosition } from "@/lib/gallery-chapters";

/**
 * The order a gallery shows its photos in (docs/PHOTO-ORDER.md), in one place
 * for every query and every comparison that depends on it: the grid's pages,
 * chapter boundaries and counts, the highlights, the ZIP, the link preview.
 *
 * Whichever order, a photo's place is `(key, id)`:
 *   - TAKEN_AT — `key` is the capture time as an ISO string (fixed width, so
 *     it compares as a plain string);
 *   - FILE_NAME — `key` is `Photo.fileOrderKey`, the file name reduced to
 *     [0-9a-z] with padded numbers, which the database and a JavaScript string
 *     comparison order the same way;
 *   - FILE_NAME_GUESTS_BY_TIME — `key` is `Photo.wovenAt` as an ISO string:
 *     the photographer's photos in file-name order, guests' woven in by
 *     capture time (src/lib/woven-order.ts).
 * `id` breaks ties: a burst shares a second, two cameras can share a name.
 */

export type { PhotoOrder };

/** Every order — a `Record` so a new enum value fails typecheck here. */
const ORDERS: Record<PhotoOrder, true> = {
  TAKEN_AT: true,
  FILE_NAME: true,
  FILE_NAME_GUESTS_BY_TIME: true,
};
export const PHOTO_ORDERS = Object.keys(ORDERS) as PhotoOrder[];

export function isPhotoOrder(value: unknown): value is PhotoOrder {
  return typeof value === "string" && value in ORDERS;
}

/** The columns `orderKeyOf` reads — spread into a Prisma `select`. */
export const ORDER_KEY_SELECT = {
  takenAt: true,
  createdAt: true,
  fileOrderKey: true,
  wovenAt: true,
} as const;

interface OrderKeyColumns {
  takenAt: Date | null;
  createdAt: Date;
  fileOrderKey: string;
  wovenAt: Date | null;
}

/** The time column a time-keyed order sorts by. */
function timeColumn(order: Exclude<PhotoOrder, "FILE_NAME">): "takenAt" | "wovenAt" {
  return order === "FILE_NAME_GUESTS_BY_TIME" ? "wovenAt" : "takenAt";
}

/**
 * A photo's key in the given order. `takenAt` is set on every confirm;
 * `createdAt` only covers the impossible null without dropping the photo.
 */
export function orderKeyOf(order: PhotoOrder, photo: OrderKeyColumns): string {
  if (order === "FILE_NAME") return photo.fileOrderKey;
  // `wovenAt` is written for every confirmed photo before a gallery switches
  // to that order and on every change after; the fallbacks only keep a photo
  // caught between two writes on the page rather than dropping it.
  const time = order === "FILE_NAME_GUESTS_BY_TIME" ? photo.wovenAt : null;
  return (time ?? photo.takenAt ?? photo.createdAt).toISOString();
}

export function positionOf(order: PhotoOrder, photo: OrderKeyColumns & { id: string }) {
  return { key: orderKeyOf(order, photo), id: photo.id } satisfies TimelinePosition;
}

/** Prisma `orderBy` for the gallery's order. */
export function photoOrderBy(order: PhotoOrder): Prisma.PhotoOrderByWithRelationInput[] {
  return order === "FILE_NAME"
    ? [{ fileOrderKey: "asc" }, { id: "asc" }]
    : [{ [timeColumn(order)]: "asc" }, { id: "asc" }];
}

/** Photos strictly after `position` — the next page of the keyset cursor. */
export function afterPosition(order: PhotoOrder, position: TimelinePosition) {
  return strictly(order, position, "gt");
}

/** Photos strictly before `position` — what precedes a chapter's start. */
export function beforePosition(order: PhotoOrder, position: TimelinePosition) {
  return strictly(order, position, "lt");
}

function strictly(
  order: PhotoOrder,
  position: TimelinePosition,
  side: "gt" | "lt",
): Prisma.PhotoWhereInput {
  const id = { [side]: position.id };
  if (order === "FILE_NAME") {
    return {
      OR: [{ fileOrderKey: { [side]: position.key } }, { fileOrderKey: position.key, id }],
    };
  }
  const column = timeColumn(order);
  const at = new Date(position.key);
  return { OR: [{ [column]: { [side]: at } }, { [column]: at, id }] };
}

/** The chapter columns `chapterStartOf` reads — spread into a Prisma `select`. */
export const CHAPTER_START_SELECT = {
  startTakenAt: true,
  startFileOrderKey: true,
  startWovenAt: true,
  startPhotoId: true,
} as const;

/**
 * Where a chapter starts in the given order. Both keys are stored, so a
 * gallery switched from one order to the other keeps every chapter on the
 * photo it was started on — and on its place, if that photo is later deleted.
 */
export function chapterStartOf(
  order: PhotoOrder,
  chapter: {
    startTakenAt: Date;
    startFileOrderKey: string;
    startWovenAt: Date | null;
    startPhotoId: string;
  },
): TimelinePosition {
  const key =
    order === "FILE_NAME"
      ? chapter.startFileOrderKey
      : (
          (order === "FILE_NAME_GUESTS_BY_TIME" ? chapter.startWovenAt : null) ??
          chapter.startTakenAt
        ).toISOString();
  return { key, id: chapter.startPhotoId };
}

type ChapterStartColumns = Parameters<typeof chapterStartOf>[1];

/** Sorts chapter rows into the gallery's order (`toSorted(compareChapterStarts(order))`). */
export function compareChapterStarts(order: PhotoOrder) {
  return (a: ChapterStartColumns, b: ChapterStartColumns) =>
    compareTimeline(chapterStartOf(order, a), chapterStartOf(order, b));
}

/**
 * How many photos would have to be moved to turn one order into the other:
 * all of them minus the longest run both orders keep in the same relative
 * order. One photo moved five places is one, not the five it passes.
 */
export function photosOutOfPlace(a: readonly string[], b: readonly string[]): number {
  const rank = new Map(b.map((id, i) => [id, i]));
  // Longest increasing subsequence of `a`'s ids ranked by `b`, O(n log n).
  const tails: number[] = [];
  for (const id of a) {
    const r = rank.get(id);
    if (r === undefined) continue;
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (tails[mid]! < r) lo = mid + 1;
      else hi = mid;
    }
    tails[lo] = r;
  }
  return a.length - tails.length;
}

/** A well-formed key for the order — what a cursor coming back from a client
 * must carry before it is put into a query. */
export function isValidOrderKey(order: PhotoOrder, key: string): boolean {
  // A 512-character file name keys to at most ~2.5 times its length (every
  // digit run gains a length prefix, "æ" becomes "ae"); 4096 is well clear.
  if (order === "FILE_NAME") return /^[0-9a-z]*$/.test(key) && key.length <= 4096;
  return !Number.isNaN(new Date(key).getTime());
}
