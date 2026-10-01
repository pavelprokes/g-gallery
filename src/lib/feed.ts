import "server-only";
import { prisma } from "@/lib/db";
import type { ActivityType } from "@/generated/prisma/enums";

/**
 * The owner's Updates feed — the in-app half of the notification pipeline
 * (docs/PLAN.md §8). Google Photos shows activity in-app and emails only for a
 * new album; this is the in-app surface, with push and the digest layered on it.
 */

/** Raw events per page — the page groups them (src/lib/feed-group.ts), so a
 *  morning of downloads is one row, and 100 still makes a short page. */
const DEFAULT_LIMIT = 100;

/** Where the next page starts: strictly older than this event. `id` breaks
 *  ties between events stored in the same millisecond. */
export interface FeedCursor {
  createdAt: Date;
  id: string;
}

export interface FeedEntry {
  id: string;
  type: ActivityType;
  createdAt: Date;
  galleryId: string;
  galleryTitle: string;
  photoId: string | null;
  photoObjectKey: string | null;
  /** Tells anonymous viewers apart when grouping; never shown. */
  viewerId: string | null;
  /** Only ever a name the viewer typed in themselves. */
  viewerName: string | null;
}

/**
 * Which events are worth the owner's attention.
 *
 * GALLERY_VIEW is excluded on purpose: the share page posts one on load and
 * again every 5 minutes as a heartbeat, so including it would bury every real
 * interaction under a wall of repeat visits. Session counts already answer
 * "how many views" in the dashboard.
 */
const FEED_TYPES: ActivityType[] = ["REACTION", "FAVORITE", "DOWNLOAD", "VISITOR_IDENTIFIED"];

/**
 * Recent activity across every gallery this user owns, newest first, one page
 * at a time. `next` is the cursor for the page after this one, null at the end.
 */
export async function ownerFeed(
  ownerId: string,
  before?: FeedCursor,
  limit = DEFAULT_LIMIT,
): Promise<{ entries: FeedEntry[]; next: FeedCursor | null }> {
  const events = await prisma.activityEvent.findMany({
    where: {
      type: { in: FEED_TYPES },
      gallery: { ownerId },
      ...(before && {
        OR: [
          { createdAt: { lt: before.createdAt } },
          { createdAt: before.createdAt, id: { lt: before.id } },
        ],
      }),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    // One extra row says whether an older page exists.
    take: limit + 1,
    select: {
      id: true,
      type: true,
      createdAt: true,
      galleryId: true,
      gallery: { select: { title: true } },
      photoId: true,
      photo: { select: { objectKey: true } },
      viewerId: true,
      viewer: { select: { displayName: true } },
    },
  });

  const page = events.slice(0, limit);
  const last = page.at(-1);
  const entries = page.map((event) => ({
    id: event.id,
    type: event.type,
    createdAt: event.createdAt,
    galleryId: event.galleryId,
    galleryTitle: event.gallery.title,
    photoId: event.photoId,
    photoObjectKey: event.photo?.objectKey ?? null,
    viewerId: event.viewerId,
    viewerName: event.viewer?.displayName ?? null,
  }));
  return {
    entries,
    next: events.length > limit && last ? { createdAt: last.createdAt, id: last.id } : null,
  };
}

/**
 * How many feed-worthy events arrived since the owner last opened the feed.
 * Counted, not derived from the page above, so the badge stays correct when
 * more than one page of events is unread.
 */
export async function unreadCount(ownerId: string): Promise<number> {
  const user = await prisma.user.findUnique({
    where: { id: ownerId },
    select: { feedLastReadAt: true },
  });

  return prisma.activityEvent.count({
    where: {
      type: { in: FEED_TYPES },
      gallery: { ownerId },
      // A never-opened feed counts everything rather than nothing.
      ...(user?.feedLastReadAt ? { createdAt: { gt: user.feedLastReadAt } } : {}),
    },
  });
}

/** Marks the feed read. Idempotent; the timestamp only ever moves forward. */
export async function markFeedRead(ownerId: string): Promise<void> {
  await prisma.user.update({
    where: { id: ownerId },
    data: { feedLastReadAt: new Date() },
  });
}
